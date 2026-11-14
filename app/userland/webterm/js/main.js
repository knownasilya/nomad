// nomad://webterm: the drive terminal. Ctrl+` (View → Toggle Terminal) opens it as a pane under
// the page; it starts in the page's drive, and its commands read and change that drive (ls, cat,
// write, mv, rm…), look back through its versions (versions, diff, restore), search it (find,
// grep, search) and ask the user's own AI (ai, or ?).
//
// The command line is an <input> with readline's keys, history (Up/Down, Ctrl+R, `!!`), a greyed
// suggestion from history, and Tab completion of commands, options and paths. The pure rules are
// in js/lib/ (tests/unit/webterm.test.js); the commands are js/builtins/.

import { LitElement, html, TemplateResult } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { repeat } from 'nomad://app-stdlib/vendor/lit-element/lit-html/directives/repeat.js';
import { parser } from './lib/parser.js';
import { Cliclopts } from './lib/cliclopts.1.1.1.js';
import { createDrive } from './lib/term-drive-wrapper.js';
import { joinPath, shortenAllKeys } from 'nomad://app-stdlib/js/strings.js';
import { writeToClipboard } from 'nomad://app-stdlib/js/clipboard.js';
import * as line from './lib/line.js';
import * as hist from './lib/history.js';
import { friendlyError } from './lib/errors.js';
import * as builtinsFns from './builtins/index.js';
import builtinsManifest, { GROUPS, ALIASES } from './builtins/manifest.js';
import { TermAI } from './builtins/ai.js';
import css from '../css/main.css.js';
import './lib/term-icon.js';

const MENU_LIMIT = 40;
const HISTORY_KEY = 'commandHistory';

const icon = (name, regular = false) =>
  html`<span class="${regular ? 'far' : 'fas'} fa-${name}" aria-hidden="true"></span>`;

let blockIds = 0;

class WebTerm extends LitElement {
  static get styles() {
    return [css];
  }

  constructor() {
    super();
    // Outside a tab (a test page) there is no pane to attach to.
    try {
      nomad.panes.setAttachable();
    } catch (e) {
      /* not in a tab */
    }
    this.isLoaded = false;
    this._url = '';
    this.commands = {};
    this.pageCommands = {};
    this.cwd = undefined;
    this.prevCwd = undefined;
    this.home = 'hyper://private/';
    this.blocks = [];
    this.envVars = {};
    this.driveInfo = new Map(); // origin → { title, writable } | 'loading'
    this.history = readHistory();
    this.histNav = null; // { index, prefix } while stepping with Up/Down
    this.menu = null; // { items, selected, start, end }
    this.search = null; // Ctrl+R: { query, index }
    this.lineValue = '';
    this.running = null; // the block whose command runs now
    this.stick = true; // keep the newest output in view
    this.ai = new TermAI(this);
    // Folders made with mkdir that have nothing in them yet. A newer drive keeps no empty folders
    // (a folder is there while a file is in it), so the terminal remembers them for cd and ls.
    this.madeDirs = new Set();
    this.welcome = true;

    this.addEventListener('click', (e) => this.onClick(e));
    this.addEventListener('keydown', (e) => this.onHostKeyDown(e));
    (async () => {
      let ctx = new URLSearchParams(location.search).get('url');
      if (ctx && ctx.startsWith('nomad://webterm')) ctx = undefined;
      try {
        const attachedPane = await nomad.panes.attachToLastActivePane();
        if (attachedPane) ctx = attachedPane.url;
      } catch (e) {
        /* not in a tab */
      }
      if (ctx && ctx.startsWith('hyper://')) this.home = new URL(ctx).origin + '/';
      await this.load(ctx || 'hyper://private/');
      this.setFocus();
    })();
  }

  get url() {
    return this._url;
  }

  set url(v) {
    history.replaceState({}, '', `/?url=${v}`);
    this._url = v;
  }

  get input() {
    return this.shadowRoot && this.shadowRoot.querySelector('.line input');
  }

  async load(url) {
    this.url = url;
    var cwd = this.parseURL(this.url);
    while (cwd.pathname !== '/') {
      try {
        let st = await createDrive(cwd.origin).stat(cwd.pathname);
        if (st.isDirectory()) break;
      } catch (e) {
        /* ignore */
      }
      cwd.pathname = cwd.pathname.split('/').slice(0, -1).join('/') || '/';
    }
    this.cwd = cwd;
    if (!this.isLoaded) {
      await this.importEnvironment();
      this.isLoaded = true;
    }
    this.requestUpdate();
  }

  // commands
  // =

  async importEnvironment() {
    this.commands = {};
    this.pageCommands = {};
    /* dont await */ this.loadEnvVars();
    this.loadBuiltins();
    await this.loadInstalledCommands().catch((err) => this.printError(err));
    await this.loadPageCommands().catch(() => {});
  }

  loadBuiltins() {
    this.commands.help = {
      fn: this.help.bind(this),
      package: 'builtins',
      name: 'help',
      group: 'terminal',
      path: ['help'],
      help: 'List the commands, or explain one',
      usage: 'help [command]',
      autocomplete: 'commands',
      examples: ['help', 'help ls'],
    };
    for (let command of builtinsManifest.commands) {
      this.commands[command.name] = {
        ...command,
        fn: builtinsFns[command.name],
        package: 'builtins',
        path: [command.name],
        subcommands: subcommandsMap('builtins', (name) => builtinsFns[command.name][name], command.name, command.subcommands),
      };
    }
  }

  async loadInstalledCommands() {
    // readFile resolves null (not a rejection) when the file is missing, and
    // JSON.parse(null) is null — so default before parsing, not just in catch.
    var installed = await nomad.fs
      .readFile('hyper://private/webterm/installed.json')
      .then((str) => JSON.parse(str || '[]'))
      .catch((e) => []);
    if (!Array.isArray(installed)) installed = [];
    var valid = installed.filter((app) => app && typeof app.name === 'string' && typeof app.url === 'string');
    await Promise.all(
      valid.map(async (app) => {
        let subcommands = await nomad.browser
          .spawnAndExecuteJs(
            app.url,
            `
        ;(() => {
          let commands = []
          for (let command of nomad.terminal.getCommands()) {
            commands.push({ name: command.name, help: command.help, usage: command.usage,
              autocomplete: command.autocomplete, options: command.options })
          }
          return commands
        })();
      `
          )
          .catch(() => []);
        this.commands[app.name] = {
          package: app.name,
          name: app.name,
          group: 'installed',
          help: typeof app.description === 'string' ? app.description : undefined,
          path: [app.name],
          subcommands: subcommandsMap(
            app.name,
            (name) =>
              (...args) =>
                nomad.browser.spawnAndExecuteJs(
                  app.url,
                  `
            ;(() => {
              let command = nomad.terminal.getCommands().find(c => c.name === ${JSON.stringify(name)});
              if (command) return command.handle.apply(command, ${JSON.stringify(args)})
            })();
          `
                ),
            app.name,
            subcommands
          ),
        };
      })
    );
  }

  async loadPageCommands() {
    var attachedPane = this.attachedPane();
    if (!attachedPane) {
      this.pageCommands = {};
      return;
    }
    this.pageCommands =
      (await nomad.panes
        .executeJavaScript(
          attachedPane.id,
          `
      ;(() => {
        let commands = {}
        for (let command of (window.nomad && nomad.terminal ? nomad.terminal.getCommands() : [])) {
          commands[command.name] = {
            package: 'page commands',
            name: '@' + command.name,
            group: 'page-commands',
            path: ['@' + command.name],
            help: command.help,
            usage: command.usage,
            autocomplete: command.autocomplete,
            options: command.options,
          }
        }
        return commands
      })();
    `
        )
        .catch(() => ({}))) || {};
  }

  attachedPane() {
    try {
      return nomad.panes.getAttachedPane();
    } catch (e) {
      return undefined;
    }
  }

  async loadEnvVars() {
    try {
      this.envVars = (await nomad.fs.readFile('hyper://private/webterm/env.json', 'json')) || {};
    } catch (err) {
      this.envVars = {};
    }
  }

  async persistEnvVars() {
    var envVars = JSON.parse(JSON.stringify(this.envVars));
    delete envVars['@'];
    delete envVars.cwd;
    await nomad.fs.mkdir('hyper://private/webterm').catch(() => {});
    await nomad.fs.writeFile('hyper://private/webterm/env.json', envVars, 'json');
  }

  getAllEnv() {
    return Object.assign({}, this.envVars, { cwd: this.cwd.toString(), home: this.home });
  }

  getEnv(key) {
    if (key === 'cwd') return this.cwd.toString();
    if (key === 'home') return this.home;
    return this.envVars[key] || '';
  }

  async setEnv(key, value) {
    if (key === '@' || key === 'cwd' || key === 'home') throw new Error(`$${key} is set by the terminal`);
    await this.loadEnvVars();
    if (!value) delete this.envVars[key];
    else this.envVars[key] = value;
    await this.persistEnvVars();
  }

  // where we are
  // =

  setCWD(location) {
    var locationParsed;
    if (location.startsWith('hyper://')) {
      try {
        locationParsed = new URL(location);
        location = `${locationParsed.host}${locationParsed.pathname}`;
      } catch (err) {
        location = `${this.cwd.host}${joinPath(this.cwd.pathname, location)}`;
      }
      locationParsed = new URL('hyper://' + location);
    } else {
      locationParsed = new URL(location);
    }
    if (this.cwd && this.cwd.toString() === locationParsed.toString()) return;
    this.prevCwd = this.cwd ? this.cwd.toString() : undefined;
    this.url = locationParsed.toString();
    this.cwd = locationParsed;
    this.requestUpdate();
  }

  parseURL(url) {
    if (!url.includes('://')) url = 'hyper://' + url;
    return new URL(url);
  }

  // A drive's title and whether the user can change it, cached; null until it's known.
  infoFor(origin) {
    if (!origin || !origin.startsWith('hyper://')) return null;
    const got = this.driveInfo.get(origin);
    if (got === 'loading') return null;
    if (got) return got;
    this.driveInfo.set(origin, 'loading');
    nomad.fs
      .getInfo(origin)
      .then((info) => {
        this.driveInfo.set(origin, { title: (info && info.title) || '', writable: !!(info && info.writable) });
        this.requestUpdate();
      })
      .catch(() => this.driveInfo.set(origin, { title: '', writable: false }));
    return null;
  }

  async driveInfoNow(origin) {
    try {
      const info = await nomad.fs.getInfo(origin);
      const v = { title: (info && info.title) || '', writable: !!(info && info.writable) };
      this.driveInfo.set(origin, v);
      return v;
    } catch (e) {
      return { title: '', writable: false };
    }
  }

  placeOf(cwd) {
    if (!cwd) return { drive: '', path: '', writable: false, hyper: false };
    const hyper = cwd.protocol === 'hyper:';
    const info = hyper ? this.infoFor(cwd.origin) : null;
    let drive = info && info.title ? info.title : shortenHash(cwd.host);
    if (cwd.host === 'private') drive = 'private';
    const path = decodeURIComponent(shortenAllKeys(cwd.pathname || '/'));
    return { drive, path: path.length > 1 ? path.replace(/\/$/, '') : '/', writable: !!(info && info.writable), hyper, known: !!info };
  }

  renderPs(cwd, { cmd, failed } = {}) {
    const p = this.placeOf(cwd);
    return html`<span class="ps"
      ><a class="drive" href=${cwd.origin + '/'} title=${cwd.toString()}>${p.drive}</a
      ><span class="path">${p.path}</span>${p.hyper && p.known && !p.writable
        ? html`<span class="lock" title="Read only: you can't change this drive">${icon('lock')}</span>`
        : ''}<span class="caret ${failed ? 'failed' : ''}">❯</span>${cmd != null ? html`<span class="cmd">${cmd}</span>` : ''}</span
    >`;
  }

  // output
  // =

  newBlock(input, cwd = this.cwd) {
    const block = { id: ++blockIds, cwd: new URL(cwd.toString()), input, entries: [], status: 'running', startedAt: Date.now() };
    this.blocks.push(block);
    this.stick = true;
    this.requestUpdate();
    return block;
  }

  print(block, output) {
    const rendered = renderResult(output);
    if (rendered == null) return;
    block.entries.push(rendered);
    this.requestUpdate();
  }

  printError(err, block) {
    if (err && err.shown) return;
    const b = block || this.newBlock(null);
    const f = friendlyError(err, { cwd: this.cwd && this.cwd.toString() });
    b.entries.push(renderError(f));
    if (!block) b.status = 'error';
    this.requestUpdate();
  }

  clearHistory() {
    this.blocks = [];
    this.welcome = false;
    this.requestUpdate();
  }

  // running a line
  // =

  async runLine(raw, { record = true } = {}) {
    let input = raw;
    if (!input.trim()) return;
    if (record) {
      this.history = hist.addEntry(this.history, raw);
      saveHistory(this.history);
    }
    this.histNav = null;
    this.menu = null;
    // `!!` and friends, but not in a question for the AI.
    if (!/^\s*(ai|\?)(\s|$)/.test(input)) {
      try {
        const ex = hist.expandBang(input, this.history.slice(0, -1));
        input = ex.line;
      } catch (err) {
        const b = this.newBlock(raw);
        this.printError(err, b);
        b.status = 'error';
        return;
      }
    }

    const block = this.newBlock(input);
    this.running = block;
    const controller = new AbortController();
    block.abort = () => controller.abort();
    this.requestUpdate();
    await this.updateComplete;
    this.shadowRoot.querySelector('.screen')?.focus({ preventScroll: true });

    let ok = true;
    let commands;
    try {
      commands = line.splitCommands(input);
    } catch (err) {
      commands = [];
      this.printError(err, block);
      ok = false;
    }
    // `a && b` runs b only when a worked; `a; b` runs b either way (as a shell does).
    for (const { line: one, and } of commands) {
      if (controller.signal.aborted) break;
      if (and && !ok) continue;
      ok = await this.runOne(one, block, controller.signal);
    }
    if (controller.signal.aborted) {
      block.entries.push(html`<div class="faint">^C</div>`);
      ok = false;
    }
    block.status = ok ? 'ok' : 'error';
    block.took = Date.now() - block.startedAt;
    this.lastRun = { input, ok, error: block.error };
    this.running = null;
    this.loadPageCommands().catch(() => {});
    this.requestUpdate();
    await this.updateComplete;
    this.setFocus();
  }

  // One command; true when it worked.
  async runOne(input, block, signal) {
    let redirect = null;
    try {
      ({ line: input, redirect } = line.splitRedirect(input));
    } catch (err) {
      this.printError(err, block);
      return false;
    }
    input = expandAlias(input);

    // The AI takes the rest of the line as it was typed (quotes and all).
    const head = input.trim().split(/\s+/)[0];
    let command;
    let argv;
    let attachedPane = this.attachedPane();
    this.envVars['@'] = attachedPane ? attachedPane.url : this.cwd.toString();

    if (this.commands[head] && this.commands[head].raw) {
      command = this.commands[head];
      argv = rawArgv(input.trim().slice(head.length), command);
    } else {
      let parsed;
      try {
        parsed = parser.parse(input);
      } catch (e) {
        this.printError(new Error(`Couldn't read that line: ${e.message}`), block);
        return false;
      }
      this.applySubstitutions(parsed);
      let paramsIndex = 1;
      const name = parsed[0].value;
      if (name.startsWith('@')) {
        await this.loadPageCommands().catch(() => {});
        command = this.pageCommands[name.slice(1)];
        if (command) {
          command = {
            ...command,
            fn: (...args) =>
              nomad.panes.executeJavaScript(
                attachedPane.id,
                `
            ;(() => {
              let command = nomad.terminal.getCommands().find(c => c.name === ${JSON.stringify(name.slice(1))});
              if (command) return command.handle.apply(command, ${JSON.stringify(args)})
            })();
          `
              ),
          };
        }
      } else {
        command = this.commands[name];
        if (command && command.subcommands) {
          const sub = parsed[1] && command.subcommands[parsed[1].value];
          if (sub) {
            command = sub;
            paramsIndex = 2;
          } else {
            argv = [{}, name];
            command = this.commands.help;
            paramsIndex = null;
          }
        }
      }
      if (!command) {
        this.printError(unknownCommand(name, this), block);
        return false;
      }
      if (paramsIndex != null) {
        const cliclopts = new Cliclopts(command.options);
        argv = this.toArgv(parsed.slice(paramsIndex), cliclopts.options());
        if ('h' in argv[0] || 'help' in argv[0]) {
          argv = [{}].concat(parsed.slice(0, paramsIndex).map((v) => v.value));
          command = this.commands.help;
        }
      }
    }

    const ctx = this.contextFor(block, signal);
    try {
      let res = await command.fn.call(ctx, ...argv);
      if (redirect) {
        res = await this.writeRedirect(res, redirect);
      }
      this.print(block, res);
      return true;
    } catch (err) {
      block.error = err && err.message;
      this.printError(err, block);
      return false;
    }
  }

  async writeRedirect(res, { path, append }) {
    const text = resultToText(res);
    const target = this.resolve(path);
    const urlp = new URL(target);
    const drive = createDrive(urlp.origin);
    let body = text.endsWith('\n') || !text ? text : text + '\n';
    if (append) {
      const before = await drive.readFile(urlp.pathname, 'utf8').catch(() => '');
      body = (before || '') + body;
    }
    await drive.writeFile(urlp.pathname, body, 'utf8');
    return html`<div class="notice">${icon('check')}<span
        >${append ? 'Added' : 'Wrote'} ${byteLength(text)} to <a href=${target}>${decodeURIComponent(urlp.pathname)}</a></span
      ></div>`;
  }

  contextFor(block, signal) {
    const term = this;
    return {
      env: {
        getAll: this.getAllEnv.bind(this),
        get: this.getEnv.bind(this),
        set: this.setEnv.bind(this),
        goto: this.setCWD.bind(this),
        focus: this.setFocus.bind(this),
        resolve: this.resolve.bind(this),
        clearHistory: this.clearHistory.bind(this),
        reload: this.importEnvironment.bind(this),
        close: this.close.bind(this),
        home: () => this.home,
        previous: () => this.prevCwd,
      },
      // What the newer commands use: the drive info cache, questions, the history, the AI.
      term: {
        signal,
        info: (origin) => this.driveInfoNow(origin),
        confirm: (q) => ctxPrompt(q + ' [y/N]').then((a) => /^y(es)?$/i.test(String(a || '').trim())),
        fill: (text) => this.fill(text),
        history: () => this.history.slice(),
        clearHistory: () => {
          this.history = [];
          saveHistory(this.history);
        },
        ai: this.ai,
        cwd: () => this.cwd.toString(),
        lastRun: () => this.lastRun,
        commands: () => this.commands,
        madeDirs: this.madeDirs,
      },
      page: {
        goto(url, opts = {}) {
          var pane = term.attachedPane();
          if (opts.newTab || !pane) window.open(url);
          else nomad.panes.navigate(pane.id, url);
        },
        refresh() {
          var pane = term.attachedPane();
          if (!pane) throw new Error('The terminal is not attached to a page');
          nomad.panes.navigate(pane.id, pane.url);
        },
        focus() {
          var pane = term.attachedPane();
          if (!pane) throw new Error('The terminal is not attached to a page');
          nomad.panes.focus(pane.id);
        },
        exec(js) {
          var pane = term.attachedPane();
          if (!pane) throw new Error('The terminal is not attached to a page');
          return nomad.panes.executeJavaScript(pane.id, js);
        },
        inject(css) {
          var pane = term.attachedPane();
          if (!pane) throw new Error('The terminal is not attached to a page');
          return nomad.panes.injectCss(pane.id, css);
        },
        uninject(id) {
          var pane = term.attachedPane();
          if (!pane) throw new Error('The terminal is not attached to a page');
          return nomad.panes.uninjectCss(pane.id, id);
        },
      },
      out: (...args) => {
        args = args.map((arg) =>
          arg && typeof arg === 'object' && !(arg instanceof TemplateResult) && !(arg instanceof HTMLElement) && !arg.toHTML
            ? JSON.stringify(arg)
            : arg && arg.toHTML
              ? arg.toHTML()
              : arg
        );
        const spaced = [];
        args.forEach((a, i) => {
          if (i) spaced.push(' ');
          spaced.push(a);
        });
        block.entries.push(html`<div class="entry">${spaced}</div>`);
        this.requestUpdate();
      },
      prompt: (txt, defValue) => ctxPrompt(txt, defValue),
    };

    function ctxPrompt(txt, defValue) {
      return new Promise((resolve) => {
        const onKeydown = (e) => {
          if (e.key === 'Enter' || (e.key === 'c' && e.ctrlKey)) {
            e.preventDefault();
            e.stopPropagation();
            const el = e.currentTarget;
            el.value = e.key === 'Enter' ? el.value || defValue || '' : '';
            el.setAttribute('disabled', '');
            resolve(el.value);
            term.shadowRoot.querySelector('.screen')?.focus({ preventScroll: true });
          }
        };
        block.entries.push(html`<div class="subprompt">
          <span class="q">${txt}</span>
          ${defValue ? html`<span class="def">[${defValue}]</span>` : ''}
          <input @keydown=${onKeydown} aria-label=${txt} />
        </div>`);
        term.requestUpdate();
        term.updateComplete.then(() => {
          const inputs = term.shadowRoot.querySelectorAll('.subprompt input:not([disabled])');
          inputs[inputs.length - 1]?.focus();
        });
      });
    }
  }

  applySubstitutions(inputParsed) {
    const doReplace = (str) => str.replace(/\$([a-z@0-9_]+)/gi, (val) => this.getEnv(val.slice(1).toLowerCase()));
    inputParsed.forEach((term) => {
      if (typeof term.value === 'string') term.value = doReplace(term.value);
    });
  }

  toArgv(inputParsed, optsDesc) {
    var opts = {};
    var positional = [];
    // used to map aliased names (eg -f becomes --foo)
    const resolveKey = (key) => {
      var match = Object.entries(optsDesc.alias).find(([longName, aliases]) => aliases.includes(key));
      return match ? match[0] : key;
    };
    inputParsed.forEach((token) => {
      if (token.type === 'param') {
        // -la is -l -a, when both are flags.
        if (/^[a-z]{2,}$/i.test(token.key) && token.key.length <= 4 && !optsDesc.alias[token.key]) {
          const keys = token.key.split('').map(resolveKey);
          if (keys.every((k) => optsDesc.boolean.includes(k))) {
            keys.forEach((k) => (opts[k] = true));
            if (token.value !== undefined && typeof token.value !== 'boolean') positional.push(token.value);
            return;
          }
        }
        var key = resolveKey(token.key);
        var value = token.value;
        // if a boolean arg has a non-boolean value, move the value to the positional args
        if (optsDesc.boolean.includes(key)) {
          if (value !== undefined && typeof value !== 'boolean') positional.push(value);
          value = true;
        } else if (value === undefined) {
          value = true;
        }
        opts[key] = value;
      } else {
        positional.push(token.value);
      }
    });
    for (let key in optsDesc.default) {
      key = resolveKey(key);
      if (typeof opts[key] === 'undefined') opts[key] = optsDesc.default[key];
    }
    return [opts].concat(positional);
  }

  // the prompt
  // =

  setFocus() {
    const input = this.input;
    if (input && !this.running) input.focus({ preventScroll: true });
    else this.shadowRoot?.querySelector('.screen')?.focus({ preventScroll: true });
  }

  close() {
    window.close();
  }

  setLine(value, caret = value.length) {
    const input = this.input;
    if (!input) return;
    input.value = value;
    input.setSelectionRange(caret, caret);
    this.lineValue = value;
    this.requestUpdate();
  }

  fill(text) {
    this.setLine(text);
    this.menu = null;
    this.setFocus();
  }

  lookupCommand(input) {
    let cmd;
    if (input.startsWith('@')) return this.pageCommands[input.split(' ')[0].slice(1)];
    for (let token of expandAlias(input).split(/\s+/)) {
      let next = cmd ? (cmd.subcommands ? cmd.subcommands[token] : undefined) : this.commands[token];
      if (!next) break;
      cmd = next;
    }
    return cmd;
  }

  // Tab completion: what could go at the caret. [{ name, insert, help?, kind }], plus the word.
  async completions(value, caret) {
    const w = line.wordAt(value, caret);
    const typed = unescapeWord(w.word);
    const words = w.words.map(unescapeWord);
    const names = (list) => list.filter((it) => it.name.startsWith(typed));
    if (w.index === 0) {
      if (typed.startsWith('@')) {
        return { w, items: names(Object.values(this.pageCommands).map((c) => ({ name: c.name, help: c.help, kind: 'cmd' }))) };
      }
      const cmds = Object.values(this.commands)
        .filter((c) => !c.hidden)
        .map((c) => ({ name: c.name, help: c.help, kind: 'cmd' }));
      for (const [a, to] of Object.entries(ALIASES)) cmds.push({ name: a, help: `= ${to}`, kind: 'cmd' });
      return { w, items: names(cmds).sort((a, b) => a.name.localeCompare(b.name)) };
    }
    let cmd = this.lookupCommand(words[0] || '');
    if (cmd && cmd.subcommands && w.index === 1) {
      return { w, items: names(Object.values(cmd.subcommands).map((c) => ({ name: c.name, help: c.help, kind: 'cmd' }))) };
    }
    if (cmd && cmd.subcommands && words[1] && cmd.subcommands[words[1]]) cmd = cmd.subcommands[words[1]];
    if (!cmd || cmd.raw) return { w, items: [] };
    if (typed.startsWith('-')) {
      const opts = [];
      // The long names, with the short one in the help; `-x` as typed completes to its own.
      for (const o of cmd.options || []) {
        opts.push({ name: `--${o.name}`, help: `${o.abbr ? `-${o.abbr} · ` : ''}${o.help || ''}`, kind: 'opt' });
        if (o.abbr && typed === `-${o.abbr}`) opts.push({ name: typed, help: o.help, kind: 'opt' });
      }
      return { w, items: names(opts) };
    }
    if (cmd.autocomplete === 'commands') {
      return { w, items: names(Object.values(this.commands).map((c) => ({ name: c.name, help: c.help, kind: 'cmd' }))) };
    }
    if (cmd.autocomplete === 'env') {
      return { w, items: names(Object.keys(this.getAllEnv()).map((k) => ({ name: k, kind: 'opt' }))) };
    }
    if (cmd.autocomplete === 'files' || cmd.autocomplete === 'dirs') {
      return { w, items: await this.fileCompletions(typed, cmd.autocomplete === 'dirs') };
    }
    return { w, items: [] };
  }

  async fileCompletions(typed, dirsOnly) {
    const slash = typed.lastIndexOf('/');
    const dirPart = slash === -1 ? '' : typed.slice(0, slash + 1);
    const namePart = typed.slice(slash + 1);
    let location;
    try {
      location = new URL(this.resolve(dirPart || '.'));
    } catch (e) {
      return [];
    }
    if (location.protocol !== 'hyper:') return [];
    const entries = await createDrive(location.origin)
      .readdir(location.pathname || '/', { includeStats: true })
      .catch(() => []);
    const showHidden = namePart.startsWith('.');
    let items = entries
      .filter((e) => showHidden || !e.name.startsWith('.'))
      .filter((e) => !dirsOnly || e.stat.isDirectory())
      .map((e) => {
        const dir = e.stat.isDirectory();
        return { name: e.name + (dir ? '/' : ''), base: e.name, kind: dir ? 'dir' : 'file', dir, dirPart };
      });
    let hits = items.filter((it) => it.base.startsWith(namePart));
    if (!hits.length) hits = items.filter((it) => it.base.toLowerCase().startsWith(namePart.toLowerCase()));
    return hits.sort((a, b) => (a.dir === b.dir ? a.base.localeCompare(b.base) : a.dir ? -1 : 1));
  }

  // The word at the caret becomes `text` (as typed: escaped).
  replaceWord(w, item, { final = true } = {}) {
    const value = this.input.value;
    let insert;
    if (item.kind === 'dir' || item.kind === 'file') {
      insert = line.escapeWord(item.dirPart + item.base) + (item.dir ? '/' : final ? ' ' : '');
    } else {
      insert = line.escapeWord(item.name) + (final ? ' ' : '');
    }
    const next = value.slice(0, w.start) + insert + value.slice(w.end);
    this.setLine(next, w.start + insert.length);
  }

  async onTab(back) {
    if (this.menu) {
      const n = this.menu.items.length;
      this.menu.selected = (this.menu.selected + (back ? -1 : 1) + n) % n;
      this.requestUpdate();
      return;
    }
    const input = this.input;
    const value = input.value;
    const caret = input.selectionStart;
    const { w, items } = await this.completions(value, caret);
    if (this.input.value !== value) return; // typed on meanwhile
    if (!items.length) return;
    if (items.length === 1) {
      this.replaceWord(w, items[0]);
      this.refreshCompletionsIfOpen();
      return;
    }
    // Several: as far as they all agree, then a menu to pick from.
    const typed = unescapeWord(w.word);
    const isFile = items[0].kind === 'dir' || items[0].kind === 'file';
    const prefix = line.commonPrefix(items.map((it) => (isFile ? it.base : it.name)));
    const typedName = isFile ? typed.slice(typed.lastIndexOf('/') + 1) : typed;
    if (prefix.length > typedName.length) {
      this.replaceWord(w, isFile ? { ...items[0], base: prefix, dir: false } : { name: prefix }, { final: false });
      return;
    }
    this.menu = { items, selected: 0, w };
    this.requestUpdate();
  }

  async refreshCompletionsIfOpen() {
    if (!this.menu) return;
    const input = this.input;
    const { w, items } = await this.completions(input.value, input.selectionStart);
    this.menu = items.length > 1 ? { items, selected: 0, w } : null;
    this.requestUpdate();
  }

  acceptMenu(i = this.menu && this.menu.selected) {
    if (!this.menu) return;
    const item = this.menu.items[i];
    const w = line.wordAt(this.input.value, this.input.selectionStart);
    this.menu = null;
    if (item) this.replaceWord(w, item);
    this.setFocus();
  }

  // The greyed rest of a line from history, after the caret.
  get suggestion() {
    const input = this.input;
    if (!input || this.search || this.menu) return '';
    if (input.selectionStart !== input.value.length) return '';
    const s = hist.suggest(this.history, this.lineValue);
    return s ? s.slice(this.lineValue.length) : '';
  }

  // help
  // =

  help(opts, ...topic) {
    const all = this.commands;
    if (topic[0]) {
      const name = ALIASES[topic[0]] ? ALIASES[topic[0]].split(' ')[0] : topic[0];
      const cmd = this.lookupCommand([name, ...topic.slice(1)].join(' '));
      if (!cmd) throw unknownCommand(topic.join(' '), this);
      if (cmd.subcommands && !topic[1]) {
        const subs = Object.values(cmd.subcommands);
        return renderHelpGroup(cmd.help, subs, cmd.name + ' ');
      }
      return renderCommandHelp(cmd, topic[0]);
    }
    const groups = GROUPS.map((g) => ({
      ...g,
      cmds: Object.values(all).filter((c) => (c.group || 'installed') === g.id && !c.hidden),
    }));
    const pageCmds = Object.values(this.pageCommands);
    if (pageCmds.length) groups.push({ id: 'page-commands', title: 'This page’s commands', cmds: pageCmds });
    const width = Math.max(...Object.values(all).map((c) => c.name.length), 6) + 2;
    return {
      toText: () =>
        groups
          .filter((g) => g.cmds.length)
          .map((g) => `${g.title}\n` + g.cmds.map((c) => `  ${c.name.padEnd(width)}${c.help || ''}`).join('\n'))
          .join('\n\n'),
      toHTML: () => html`
        ${groups
          .filter((g) => g.cmds.length)
          .map(
            (g) => html`<div class="help-group" style="--w: ${width}ch">
              <h4>${g.title}</h4>
              ${g.cmds.map(
                (c) => html`<div class="help-cmd">
                  <a class="name" data-run=${'help ' + c.name.replace(/^@/, '')}>${c.name}</a>
                  <span class="desc">${c.help || ''}</span>
                </div>`
              )}
            </div>`
          )}
        <div class="tip muted" style="margin-top: 8px">
          <code>help &lt;command&gt;</code> explains one · <kbd>Tab</kbd> completes · <kbd>↑</kbd> history ·
          <kbd>Ctrl</kbd>+<kbd>R</kbd> searches it · <code>? question</code> asks the AI ·
          <code>a &amp;&amp; b</code>, <code>a; b</code> and <code>&gt; file</code> work too
        </div>
      `,
    };
  }

  // userland-facing methods
  // =

  resolve(location) {
    const cwd = this.cwd;
    location = String(location ?? '');
    if (location === '~' || location.startsWith('~/')) {
      location = this.home.replace(/\/$/, '') + location.slice(1);
    }
    if (location === '.' || location === '') return cwd.toString();
    if (location.startsWith('./')) location = location.slice(2);
    if (!location.startsWith('/') && !location.includes('://')) {
      location = joinPath(cwd.pathname, location);
    }
    if (!location.includes('://')) {
      let parts = location.split('/');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === '..') {
          if (parts[i - 1]) {
            parts.splice(i - 1, 1);
            i--;
          }
          parts.splice(i, 1);
          i--;
        } else if (parts[i] === '.') {
          parts.splice(i, 1);
          i--;
        }
      }
      location = parts.join('/') || '/';
      if (!location.startsWith('/')) location = '/' + location;
      location = joinPath(cwd.origin, location);
    }
    return location;
  }

  // rendering
  // =

  render() {
    if (!this.cwd) return html`<div></div>`;
    const place = this.placeOf(this.cwd);
    const title = `${place.drive}${place.path === '/' ? '' : place.path} · Terminal`;
    if (document.title !== title) document.title = title;
    const busy = !!this.running;
    const sugg = busy ? '' : this.suggestion;
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      <div class="bar">
        <div class="where">
          ${icon('terminal')}
          <span class="drive">${place.drive}</span>
          <span class="path">${place.path}</span>
          ${place.hyper && place.known
            ? place.writable
              ? html`<span class="badge edit" title="You can change this drive">${icon('pen')} Can edit</span>`
              : html`<span class="badge" title="You can read this drive but not change it">${icon('lock')} Read only</span>`
            : ''}
          ${this.ai.active ? html`<span class="badge chat" title="The AI chat this terminal is in">${icon('robot')} AI chat</span>` : ''}
        </div>
        <button class="icon-btn" title="Ask the AI (? question)" aria-label="Ask the AI" @click=${() => this.fill('? ')}>
          ${icon('robot')}
        </button>
        <button class="icon-btn" title="Commands (help)" aria-label="Commands" @click=${() => this.runLine('help')}>
          ${icon('question-circle')}
        </button>
        <button class="icon-btn" title="Clear the screen (Ctrl+L)" aria-label="Clear the screen" @click=${() => (this.clearHistory(), this.setFocus())}>
          ${icon('eraser')}
        </button>
        <button class="icon-btn" title="Close the terminal (Ctrl+\`)" aria-label="Close the terminal" @click=${() => this.close()}>
          ${icon('times')}
        </button>
      </div>
      <div class="screen" tabindex="-1" @scroll=${this.onScroll}>
        ${this.welcome ? this.renderWelcome(place) : ''}
        ${repeat(
          this.blocks,
          (b) => b.id,
          (b) => this.renderBlock(b)
        )}
        ${busy
          ? html`<div class="hint">${b2('Ctrl')}+${b2('C')} stops it</div>`
          : html`
              <div class="prompt">
                ${this.search
                  ? html`<span class="search-mode">${icon('history')} history search
                      <strong>${this.search.query}</strong> ❯</span>`
                  : this.renderPs(this.cwd)}
                <div class="line">
                  <div class="ghost" aria-hidden="true"><span class="typed">${this.lineValue}</span>${sugg}</div>
                  <input
                    aria-label="Command"
                    spellcheck="false"
                    autocomplete="off"
                    autocapitalize="off"
                    @keydown=${this.onKeyDown}
                    @input=${this.onInput}
                    @paste=${this.onPaste}
                    @blur=${() => this.requestUpdate()}
                  />
                </div>
              </div>
              ${this.renderMenu()} ${this.renderHint()}
            `}
      </div>
    `;
  }

  renderWelcome(place) {
    return html`<div class="welcome">
      <div class="title"><span class="logo">❯_</span> Nomad terminal</div>
      <div>
        You're in <strong>${place.drive}</strong>${place.hyper && place.known
          ? place.writable
            ? ', which you can change.'
            : ', which is read only for you.'
          : '.'}
      </div>
      <div class="tips">
        <span><a class="link" data-run="help">help</a> lists commands</span>
        <span><kbd>Tab</kbd> completes</span>
        <span><kbd>↑</kbd> <kbd>Ctrl</kbd>+<kbd>R</kbd> history</span>
        <span><code class="k">? question</code> asks the AI</span>
        <span><a class="link" data-run="tree">tree</a> · <a class="link" data-run="versions">versions</a></span>
      </div>
    </div>`;
  }

  renderBlock(b) {
    const failed = b.status === 'error';
    return html`<div class="block">
      ${b.input != null
        ? html`<div class="ps-line">${this.renderPs(b.cwd, { cmd: b.input, failed })}</div>
            <div class="tools">
              <button class="icon-btn small" title="Copy the output" aria-label="Copy the output" data-copy-block=${b.id}>
                ${icon('copy', true)}
              </button>
              <button class="icon-btn small" title="Run it again" aria-label="Run it again" data-run=${b.input}>
                ${icon('redo')}
              </button>
            </div>`
        : ''}
      <div class="out" data-block=${b.id}>
        ${b.entries.map((e) => html`<div class="entry">${e}</div>`)}
        ${b.status === 'running' && !b.entries.length ? html`<span class="spinner"></span>` : ''}
      </div>
    </div>`;
  }

  renderMenu() {
    if (!this.menu) return '';
    const { items, selected } = this.menu;
    const typed = unescapeWord(line.wordAt(this.lineValue, this.input ? this.input.selectionStart : 0).word);
    const typedName = typed.slice(typed.lastIndexOf('/') + 1);
    const start = Math.max(0, Math.min(selected - Math.floor(MENU_LIMIT / 2), items.length - MENU_LIMIT));
    const shown = items.slice(start, start + MENU_LIMIT);
    return html`<div class="menu" role="listbox" aria-label="Completions">
      ${shown.map((it, k) => {
        const i = start + k;
        const n = it.kind === 'dir' || it.kind === 'file' ? it.name : it.name;
        const hl = it.kind === 'dir' || it.kind === 'file' ? typedName : typed;
        const name = n.startsWith(hl) && hl ? html`<strong>${hl}</strong>${n.slice(hl.length)}` : n;
        const ic = it.kind === 'dir' ? icon('folder') : it.kind === 'file' ? icon('file-alt', true) : it.kind === 'opt' ? '' : '';
        return html`<div
          class="item ${it.kind} ${i === selected ? 'selected' : ''}"
          role="option"
          aria-selected=${i === selected ? 'true' : 'false'}
          @mousedown=${(e) => (e.preventDefault(), this.acceptMenu(i))}
        >
          ${ic ? html`<span class="icon">${ic}</span>` : ''}<span class="name">${name}</span>
          ${it.help ? html`<span class="help">${it.help}</span>` : ''}
        </div>`;
      })}
      ${items.length > MENU_LIMIT ? html`<div class="more">${items.length} in all · keep typing to narrow it</div>` : ''}
    </div>`;
  }

  // Under the prompt: what the command being typed takes.
  renderHint() {
    const value = this.lineValue.trim();
    if (!value || this.search) {
      if (!this.search) return '';
      const found = this.search.index >= 0 ? this.history[this.search.index] : '';
      return html`<div class="hint">
        ${found
          ? html`<strong class="k">${found}</strong> · ${b2('Enter')} runs it · ${b2('Tab')} edits it · ${b2('Ctrl')}+${b2('R')} older · ${b2('Esc')} cancel`
          : this.search.query
            ? html`Nothing in your history has “${this.search.query}” · ${b2('Esc')} cancel`
            : html`Type to search your history · ${b2('Esc')} cancel`}
      </div>`;
    }
    const head = value.split(/\s+/)[0];
    if (head.startsWith('!')) return '';
    const cmd = this.lookupCommand(value);
    if (!cmd) {
      if (!value.includes(' ')) return '';
      const near = line.closest(expandAlias(head).split(' ')[0], Object.keys(this.commands), 1);
      return html`<div class="hint"><span class="bad">${head}</span> isn't a command${near.length
          ? html` · did you mean <strong>${near[0]}</strong>?`
          : ''} · start with <strong>?</strong> to ask the AI</div>`;
    }
    const alias = ALIASES[head];
    return html`<div class="hint">
      ${alias ? html`<strong>${head}</strong> = ${alias} · ` : ''}<strong>${cmd.usage || cmd.name}</strong>${cmd.help
        ? html` — ${cmd.help}`
        : ''}
    </div>`;
  }

  updated() {
    if (this.stick) {
      const screen = this.shadowRoot.querySelector('.screen');
      if (screen) screen.scrollTop = screen.scrollHeight;
    }
  }

  // events
  // =

  onScroll(e) {
    const s = e.currentTarget;
    this.stick = s.scrollTop + s.clientHeight >= s.scrollHeight - 24;
  }

  onClick(e) {
    const path = e.composedPath();
    const el = path.find((n) => n instanceof Element && (n.dataset?.run != null || n.dataset?.fill != null || n.dataset?.copy != null || n.dataset?.copyBlock != null || n.tagName === 'A'));
    if (el) {
      if (el.dataset.run != null) {
        e.preventDefault();
        if (!this.running) this.runLine(el.dataset.run);
        return;
      }
      if (el.dataset.fill != null) {
        e.preventDefault();
        this.fill(el.dataset.fill);
        return;
      }
      if (el.dataset.copy != null || el.dataset.copyBlock != null) {
        e.preventDefault();
        let text = el.dataset.copy;
        if (el.dataset.copyBlock != null) {
          const out = this.shadowRoot.querySelector(`.out[data-block="${el.dataset.copyBlock}"]`);
          text = out ? out.innerText : '';
        }
        copyText(text);
        flashCopied(el);
        return;
      }
      if (el.tagName === 'A' && el.getAttribute('href')) {
        e.preventDefault();
        const href = el.getAttribute('href');
        const pane = this.attachedPane();
        if (e.metaKey || e.ctrlKey || el.getAttribute('target') === '_blank' || !pane) window.open(href);
        else nomad.panes.navigate(pane.id, href);
        return;
      }
    }
    // A click that isn't selecting text goes to the prompt.
    if (window.getSelection().type !== 'Range' && !path.some((n) => n instanceof HTMLInputElement || n instanceof HTMLButtonElement)) {
      this.setFocus();
    }
  }

  // Keys that work while a command runs, and anywhere in the terminal.
  onHostKeyDown(e) {
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'c' && this.running) {
      if (window.getSelection().type === 'Range') return; // copying
      e.preventDefault();
      this.running.abort && this.running.abort();
      return;
    }
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      this.clearHistory();
      return;
    }
    const screen = this.shadowRoot.querySelector('.screen');
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      screen.scrollBy({ top: (e.key === 'PageUp' ? -1 : 1) * screen.clientHeight * 0.9 });
    }
    // Typing while focus is elsewhere in the terminal (after a click on output) goes to the prompt.
    if (!this.running && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const active = this.shadowRoot.activeElement;
      if (!active || !(active instanceof HTMLInputElement)) this.setFocus();
    }
  }

  onInput(e) {
    this.lineValue = e.currentTarget.value;
    this.histNav = null;
    if (this.search) {
      this.search.query = this.lineValue;
      this.search.index = hist.searchBack(this.history, this.search.query);
      this.requestUpdate();
      return;
    }
    this.refreshCompletionsIfOpen();
    this.requestUpdate();
  }

  onPaste(e) {
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (!text.includes('\n')) return;
    // Several lines become one line of commands, to look at before Enter.
    e.preventDefault();
    const joined = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join('; ');
    const input = e.currentTarget;
    const v = input.value;
    const s = input.selectionStart;
    this.setLine(v.slice(0, s) + joined + v.slice(input.selectionEnd), s + joined.length);
  }

  onKeyDown(e) {
    const input = e.currentTarget;
    const key = e.key;
    const ctrl = e.ctrlKey && !e.metaKey;
    const alt = e.altKey && !e.ctrlKey && !e.metaKey;
    const state = () => ({ value: input.value, start: input.selectionStart, end: input.selectionEnd });
    const apply = (s) => this.setLine(s.value, s.start);

    if (this.search) return this.onSearchKey(e);

    if (key === 'Enter') {
      e.preventDefault();
      if (this.menu) return this.acceptMenu();
      const v = input.value;
      this.setLine('');
      this.runLine(v);
      return;
    }
    if (key === 'Tab') {
      e.preventDefault();
      this.onTab(e.shiftKey);
      return;
    }
    if (key === 'Escape') {
      e.preventDefault();
      if (this.menu) this.menu = null;
      else this.setLine('');
      this.histNav = null;
      this.requestUpdate();
      return;
    }
    if (this.menu && (key === 'ArrowDown' || key === 'ArrowUp')) {
      e.preventDefault();
      const n = this.menu.items.length;
      this.menu.selected = (this.menu.selected + (key === 'ArrowDown' ? 1 : -1) + n) % n;
      this.requestUpdate();
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown' || (ctrl && (key === 'p' || key === 'n'))) {
      e.preventDefault();
      const dir = key === 'ArrowUp' || key === 'p' ? -1 : 1;
      if (!this.histNav) this.histNav = { index: this.history.length, prefix: input.value };
      const next = hist.step(this.history, this.histNav, dir);
      if (next) {
        this.histNav.index = next.index;
        this.setLine(next.value);
      }
      return;
    }
    if ((key === 'ArrowRight' || key === 'End' || (ctrl && key === 'e') || (ctrl && key === 'f')) && input.selectionStart === input.value.length) {
      const sugg = this.suggestion;
      if (sugg) {
        e.preventDefault();
        this.setLine(input.value + sugg);
        return;
      }
    }
    if (alt && key === 'ArrowRight') {
      const sugg = this.suggestion;
      if (sugg && input.selectionStart === input.value.length) {
        // Alt+→ takes one word of the suggestion.
        e.preventDefault();
        const m = /^\s*\S+/.exec(sugg);
        this.setLine(input.value + (m ? m[0] : sugg));
        return;
      }
    }
    if (ctrl && key === 'r') {
      e.preventDefault();
      this.menu = null;
      this.search = { query: '', index: this.history.length - 1, before: input.value };
      this.setLine('');
      return;
    }
    if (ctrl && key === 'c') {
      if (input.selectionStart !== input.selectionEnd || window.getSelection().type === 'Range') return; // copy
      e.preventDefault();
      if (input.value) {
        const b = this.newBlock(input.value);
        b.status = 'ok';
        b.entries.push(html`<span class="faint">^C</span>`);
      }
      this.setLine('');
      this.menu = null;
      return;
    }
    if (ctrl && key === 'u') return (e.preventDefault(), apply(line.deleteToStart(state())));
    if (ctrl && key === 'k') return (e.preventDefault(), apply(line.deleteToEnd(state())));
    if ((ctrl && key === 'w') || (e.altKey && key === 'Backspace')) {
      e.preventDefault();
      return apply(line.deleteWordBack(state()));
    }
    if (alt && (key === 'd' || key === '∂')) return (e.preventDefault(), apply(line.deleteWordForward(state())));
    if (ctrl && key === 'a') return (e.preventDefault(), input.setSelectionRange(0, 0));
    if (ctrl && key === 'e') return (e.preventDefault(), input.setSelectionRange(input.value.length, input.value.length));
    if (alt && (key === 'b' || key === '∫')) {
      e.preventDefault();
      const i = line.wordLeft(input.value, input.selectionStart);
      return input.setSelectionRange(i, i);
    }
    if (alt && (key === 'f' || key === 'ƒ')) {
      e.preventDefault();
      const i = line.wordRight(input.value, input.selectionStart);
      return input.setSelectionRange(i, i);
    }
    if (alt && (key === '.' || key === '≥')) {
      // The last word of the line before.
      e.preventDefault();
      const prev = this.history[this.history.length - 1] || '';
      const words = prev.trim().split(/\s+/);
      const last = words.length > 1 ? words[words.length - 1] : '';
      const s = state();
      const v = s.value.slice(0, s.start) + last + s.value.slice(s.end);
      return this.setLine(v, s.start + last.length);
    }
    if (ctrl && key === 'd' && !input.value) {
      e.preventDefault();
      this.close();
    }
    // Any other key moves the caret: the suggestion and hint follow on the next render.
    setTimeout(() => this.requestUpdate(), 0);
  }

  onSearchKey(e) {
    const key = e.key;
    const input = e.currentTarget;
    const found = this.search.index >= 0 ? this.history[this.search.index] : '';
    if (e.ctrlKey && key === 'r') {
      e.preventDefault();
      const next = hist.searchBack(this.history, this.search.query, this.search.index);
      if (next >= 0) this.search.index = next;
      this.requestUpdate();
      return;
    }
    if (key === 'Escape' || (e.ctrlKey && (key === 'c' || key === 'g'))) {
      e.preventDefault();
      const before = this.search.before;
      this.search = null;
      this.setLine(before || '');
      return;
    }
    if (key === 'Enter' || key === 'Tab' || key === 'ArrowRight' || key === 'ArrowLeft') {
      e.preventDefault();
      this.search = null;
      this.setLine(found || input.value);
      if (key === 'Enter' && found) {
        this.setLine('');
        this.runLine(found);
      }
      return;
    }
  }
}

customElements.define('web-term', WebTerm);

// helpers
// =

const b2 = (k) => html`<kbd>${k}</kbd>`;

function shortenHash(str = '') {
  return str.replace(/[0-9a-f]{64}/gi, (v) => `${v.slice(0, 6)}..${v.slice(-2)}`);
}

function subcommandsMap(pkgId, getFn, parentCmdName, subcommandsArray) {
  if (!subcommandsArray || !Array.isArray(subcommandsArray)) return undefined;
  let subcommands = {};
  for (let subcmd of subcommandsArray) {
    subcommands[subcmd.name] = {
      ...subcmd,
      fn: getFn(subcmd.name),
      package: pkgId,
      path: [parentCmdName, subcmd.name],
    };
  }
  return subcommands;
}

function expandAlias(input) {
  const m = /^(\s*)(\S+)(.*)$/s.exec(input);
  if (!m || !ALIASES[m[2]]) return input;
  return m[1] + ALIASES[m[2]] + m[3];
}

// A raw command (ai) gets its leading flags and the rest of the line as typed.
function rawArgv(rest, command) {
  const opts = {};
  const known = new Map();
  for (const o of command.options || []) {
    known.set('--' + o.name, o.name);
    if (o.abbr) known.set('-' + o.abbr, o.name);
  }
  let s = rest.trim();
  for (;;) {
    const m = /^(-{1,2}[\w-]+)(\s+|$)/.exec(s);
    if (!m || !known.has(m[1])) break;
    opts[known.get(m[1])] = true;
    s = s.slice(m[0].length);
  }
  return [opts, s];
}

const unescapeWord = (w) => String(w || '').replace(/^["']/, '').replace(/\\(.)/g, '$1');

function unknownCommand(name, term) {
  const near = line.closest(name, Object.keys(term.commands).concat(Object.keys(ALIASES)));
  const err = new Error(`Command not found: ${name}`);
  err.tip = near.length
    ? html`Did you mean ${near.map((n, i) => html`${i ? ', ' : ''}<a class="link" data-fill=${n + ' '}>${n}</a>`)}? · <a class="link" data-run="help">help</a> lists every command`
    : html`<a class="link" data-run="help">help</a> lists every command · start with <code>?</code> to ask the AI`;
  return err;
}

function renderResult(output) {
  if (output == null || output === '' || output === false) return null;
  if (output instanceof TemplateResult || output instanceof HTMLElement) return output;
  if (output.toHTML) return output.toHTML();
  if (typeof output === 'string' || typeof output === 'number' || typeof output === 'boolean') {
    return html`<pre>${String(output)}</pre>`;
  }
  return html`<pre>${JSON.stringify(output, null, 2)}</pre>`;
}

function resultToText(res) {
  if (res == null) return '';
  if (typeof res === 'string') return res;
  if (typeof res === 'number' || typeof res === 'boolean') return String(res);
  if (typeof res.toText === 'function') return res.toText();
  if (res instanceof TemplateResult || res instanceof HTMLElement) {
    throw new Error("This command's output can't be written to a file");
  }
  return JSON.stringify(res, null, 2);
}

function renderError(f) {
  return html`<div class="error" role="alert">
    <span class="icon">${icon('exclamation-triangle')}</span>
    <div>
      <div class="msg">${f.message}</div>
      ${f.tip ? html`<div class="tip">${f.tip}</div>` : ''}
    </div>
  </div>`;
}

function renderHelpGroup(heading, cmds, prefix = '') {
  const width = Math.max(...cmds.map((c) => (prefix + c.name).length), 6) + 2;
  return html`${heading ? html`<div class="muted" style="margin-bottom: 4px">${heading}</div>` : ''}
    <div class="help-group" style="--w: ${width}ch">
      ${cmds.map(
        (c) => html`<div class="help-cmd">
          <a class="name" data-run=${'help ' + prefix + c.name}>${prefix}${c.name}</a><span class="desc">${c.help || ''}</span>
        </div>`
      )}
    </div>`;
}

function renderCommandHelp(cmd, asTyped) {
  const opts = cmd.options || [];
  const width = Math.max(...opts.map((o) => `--${o.name}${o.abbr ? `, -${o.abbr}` : ''}`.length), 6) + 2;
  return html`
    <div><strong class="k">${(cmd.path || [cmd.name]).join(' ')}</strong>${ALIASES[asTyped] ? html` <span class="faint">(${asTyped})</span>` : ''} — ${cmd.help || ''}</div>
    ${cmd.usage ? html`<div class="usage"><span class="label">Usage:</span> ${cmd.usage}</div>` : ''}
    ${cmd.details ? html`<div class="muted" style="margin-bottom: 4px">${cmd.details}</div>` : ''}
    ${opts.length
      ? html`<div class="help-group" style="--w: ${width}ch">
          <h4>Options</h4>
          ${opts.map(
            (o) => html`<div class="help-cmd">
              <span class="name">--${o.name}${o.abbr ? `, -${o.abbr}` : ''}</span>
              <span class="desc">${o.help || ''}${'default' in o && o.default !== false && o.default !== 0 ? ` (default ${o.default})` : ''}</span>
            </div>`
          )}
        </div>`
      : ''}
    ${cmd.examples && cmd.examples.length
      ? html`<div class="help-group">
          <h4>Examples</h4>
          ${cmd.examples.map((x) => html`<div><a class="link" data-fill=${x}>${x}</a></div>`)}
        </div>`
      : ''}
  `;
}

function readHistory() {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(-hist.HISTORY_MAX) : [];
  } catch (e) {
    return [];
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch (e) {
    /* full or blocked */
  }
}

function byteLength(text) {
  const n = new TextEncoder().encode(text).length;
  return n === 1 ? '1 byte' : `${n} bytes`;
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => writeToClipboard(text));
  } else {
    writeToClipboard(text);
  }
}

function flashCopied(el) {
  const span = el.querySelector('span');
  if (!span) return;
  const before = span.className;
  span.className = 'fas fa-check';
  setTimeout(() => (span.className = before), 1200);
}

