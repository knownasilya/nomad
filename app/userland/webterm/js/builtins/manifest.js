// The terminal's built-in commands: name, group (for help), usage, options, and what Tab completes
// after it (`autocomplete`: files, dirs, commands, env). The functions are in ./index.js.

// help's sections, in order.
export const GROUPS = [
  { id: 'look', title: 'Look around' },
  { id: 'change', title: 'Change files' },
  { id: 'find', title: 'Find' },
  { id: 'versions', title: 'Versions' },
  { id: 'drive', title: 'Drives and pages' },
  { id: 'ai', title: 'AI' },
  { id: 'terminal', title: 'Terminal' },
  { id: 'installed', title: 'Installed commands' },
];

// Short names for longer commands.
export const ALIASES = {
  '?': 'ai',
  ll: 'ls -l',
  la: 'ls -a',
  open: 'go',
  dir: 'ls',
  type: 'cat',
  del: 'rm',
  log: 'versions',
};

export default {
  commands: [
    // look around
    {
      name: 'ls',
      group: 'look',
      help: 'List a folder',
      usage: 'ls [path] [-l] [-a]',
      autocomplete: 'files',
      options: [
        { name: 'long', abbr: 'l', help: 'Sizes and times too', boolean: true },
        { name: 'all', abbr: 'a', help: 'Show hidden files (names starting with .)', boolean: true },
      ],
      examples: ['ls', 'ls -l posts', 'll'],
    },
    {
      name: 'tree',
      group: 'look',
      help: 'Show a folder and everything in it',
      usage: 'tree [path] [-d depth] [-a]',
      autocomplete: 'dirs',
      options: [
        { name: 'depth', abbr: 'd', help: 'How many levels deep', default: 3 },
        { name: 'all', abbr: 'a', help: 'Show hidden files too', boolean: true },
      ],
    },
    {
      name: 'cd',
      group: 'look',
      help: 'Go to a folder (cd ~ for the page’s drive, cd - to go back)',
      usage: 'cd [path]',
      autocomplete: 'dirs',
      examples: ['cd posts', 'cd ..', 'cd ~', 'cd -', 'cd hyper://private/'],
    },
    { name: 'pwd', group: 'look', help: 'Print where you are', usage: 'pwd' },
    {
      name: 'cat',
      group: 'look',
      help: 'Show a file (pictures, video and sound play here)',
      usage: 'cat {path...} [-n]',
      autocomplete: 'files',
      options: [{ name: 'number', abbr: 'n', help: 'Number the lines', boolean: true }],
    },
    {
      name: 'head',
      group: 'look',
      help: 'Show the first lines of a file',
      usage: 'head {path} [-n lines]',
      autocomplete: 'files',
      options: [{ name: 'lines', abbr: 'n', help: 'How many lines', default: 10 }],
    },
    {
      name: 'tail',
      group: 'look',
      help: 'Show the last lines of a file',
      usage: 'tail {path} [-n lines]',
      autocomplete: 'files',
      options: [{ name: 'lines', abbr: 'n', help: 'How many lines', default: 10 }],
    },
    {
      name: 'stat',
      group: 'look',
      help: 'Size, times and metadata of a file or folder',
      usage: 'stat {path}',
      autocomplete: 'files',
    },
    {
      name: 'wc',
      group: 'look',
      help: 'Count the lines, words and bytes of files',
      usage: 'wc {path...}',
      autocomplete: 'files',
    },

    // change files
    {
      name: 'write',
      group: 'change',
      help: 'Write text to a file (\\n is a new line)',
      usage: 'write {path} {text...} [-a]',
      autocomplete: 'files',
      details: 'Any command can write its output to a file too: ls > files.txt, or >> to add to the end.',
      options: [{ name: 'append', abbr: 'a', help: 'Add to the end instead of replacing', boolean: true }],
      examples: ['write notes.md "# Notes\\n\\nFirst line"', 'echo hello >> notes.md'],
    },
    {
      name: 'touch',
      group: 'change',
      help: 'Make an empty file, or mark one changed now',
      usage: 'touch {path...}',
      autocomplete: 'files',
    },
    {
      name: 'edit',
      group: 'change',
      help: 'Open a file in the editor (makes it if it isn’t there)',
      usage: 'edit {path}',
      autocomplete: 'files',
    },
    {
      name: 'mkdir',
      group: 'change',
      help: 'Make a folder',
      usage: 'mkdir {path...} [-p]',
      autocomplete: 'dirs',
      options: [{ name: 'parents', abbr: 'p', help: 'Make the folders above it too', boolean: true }],
    },
    {
      name: 'mv',
      group: 'change',
      help: 'Move or rename a file or folder',
      usage: 'mv {from} {to}',
      autocomplete: 'files',
    },
    {
      name: 'cp',
      group: 'change',
      help: 'Copy a file or folder',
      usage: 'cp {from} {to}',
      autocomplete: 'files',
    },
    {
      name: 'rm',
      group: 'change',
      help: 'Remove files, or a folder with -r (versions can put them back)',
      usage: 'rm {path...} [-r] [-f]',
      autocomplete: 'files',
      options: [
        { name: 'recursive', abbr: 'r', help: 'Remove a folder and everything in it', boolean: true },
        { name: 'force', abbr: 'f', help: "Don't ask first", boolean: true },
      ],
    },
    {
      name: 'ln',
      group: 'change',
      help: 'Make a symlink',
      usage: 'ln {target} {linkname}',
      autocomplete: 'files',
    },
    {
      name: 'readlink',
      group: 'change',
      help: 'Where a symlink points',
      usage: 'readlink {path}',
      autocomplete: 'files',
    },
    {
      name: 'meta',
      group: 'change',
      help: 'Get or set metadata on a file or folder',
      usage: 'meta {path} [key] [value] [-d]',
      autocomplete: 'files',
      options: [{ name: 'delete', abbr: 'd', help: 'Delete the key', boolean: true, default: false }],
    },

    // find
    {
      name: 'find',
      group: 'find',
      help: 'Find files by name (*.md, post-?.html)',
      usage: 'find [pattern] [path] [-t f|d]',
      autocomplete: 'files',
      options: [{ name: 'type', abbr: 't', help: 'Only files (f) or folders (d)' }],
      examples: ['find *.md', 'find index', 'find -t d'],
    },
    {
      name: 'grep',
      group: 'find',
      help: 'Find text inside files',
      usage: 'grep {text|/regex/} [path] [-i] [-l]',
      autocomplete: 'files',
      options: [
        { name: 'ignore-case', abbr: 'i', help: 'Ignore upper and lower case', boolean: true },
        { name: 'files', abbr: 'l', help: 'Only list the files that match', boolean: true },
      ],
      examples: ['grep TODO', 'grep -i "hello world" posts', 'grep /h[12]>/ index.html'],
    },
    {
      name: 'search',
      group: 'find',
      help: 'Search the words in this drive’s files (-a: all your drives)',
      usage: 'search {words...} [-a]',
      options: [{ name: 'all', abbr: 'a', help: 'Search every drive in this Space', boolean: true }],
    },
    {
      name: 'query',
      group: 'find',
      help: 'Query the filesystem (advanced)',
      usage: 'query [path...] [-t file|folder] [-s name|ctime|mtime] [-r] [--limit n] [--offset n]',
      autocomplete: 'files',
      options: [
        { name: 'type', abbr: 't', help: 'Filter the type of result (file, folder)' },
        { name: 'sort', abbr: 's', help: 'Sort by name, ctime or mtime' },
        { name: 'reverse', abbr: 'r', help: 'Reverse the results', boolean: true },
        { name: 'limit', help: 'How many results (0 means all)', default: 0 },
        { name: 'offset', help: 'Skip this many results', default: 0 },
      ],
    },

    // versions
    {
      name: 'versions',
      group: 'versions',
      help: 'What changed in this drive, newest first (or one file’s changes)',
      usage: 'versions [path] [-n count] [--open]',
      autocomplete: 'files',
      options: [
        { name: 'count', abbr: 'n', help: 'How many changes', default: 20 },
        { name: 'open', abbr: 'o', help: 'Open the full history in a tab', boolean: true },
      ],
      examples: ['versions', 'versions index.html', 'versions --open'],
    },
    {
      name: 'diff',
      group: 'versions',
      help: 'What changed in a file: since its last change, since a version, or against another file',
      usage: 'diff {path} [version|other-path]',
      autocomplete: 'files',
      examples: ['diff index.html', 'diff index.html 42', 'diff a.md b.md'],
    },
    {
      name: 'restore',
      group: 'versions',
      help: 'Put a file back as it was at a version (or the whole drive with -d)',
      usage: 'restore {path} {version} | restore -d {version}',
      autocomplete: 'files',
      options: [{ name: 'drive', abbr: 'd', help: 'Restore the whole drive to that version', boolean: true }],
      examples: ['restore index.html 42', 'restore -d 120'],
    },

    // drives and pages
    {
      name: 'info',
      group: 'drive',
      help: 'About this drive: its title, address and who can change it',
      usage: 'info [drive]',
      autocomplete: 'files',
    },
    {
      name: 'go',
      group: 'drive',
      help: 'Open a file or address in the page',
      usage: 'go [path] [-n] [-b]',
      autocomplete: 'files',
      options: [
        { name: 'new-tab', abbr: 'n', help: 'Open it in a new tab', boolean: true, default: false },
        { name: 'bookmark', abbr: 'b', help: 'Open the bookmark with this name', boolean: true },
      ],
    },
    {
      name: 'mkdrive',
      group: 'drive',
      help: 'Make a new drive',
      usage: 'mkdrive [-t title] [-d description]',
      options: [
        { name: 'title', abbr: 't', help: 'The drive’s title' },
        { name: 'desc', abbr: 'd', help: 'The drive’s description' },
      ],
    },
    {
      name: 'bookmark',
      group: 'drive',
      help: 'Bookmark this folder or an address',
      usage: 'bookmark [href] [-t title]',
      autocomplete: 'files',
      options: [{ name: 'title', abbr: 't', help: 'The bookmark’s title' }],
    },
    {
      name: 'mkgoto',
      group: 'drive',
      help: 'Make a .goto file that opens an address',
      usage: 'mkgoto {path} {href} [-t title]',
      autocomplete: 'files',
      options: [{ name: 'title', abbr: 't', help: 'Its title' }],
    },
    {
      name: 'page',
      group: 'drive',
      help: 'Run JavaScript or add CSS in the page',
      subcommands: [
        { name: 'exec', help: 'Run JavaScript in the page', usage: 'page exec {js}' },
        { name: 'inject', help: 'Add CSS to the page', usage: 'page inject {css}' },
        { name: 'uninject', help: 'Take added CSS out again', usage: 'page uninject {id}' },
      ],
    },

    // ai
    {
      name: 'ai',
      group: 'ai',
      raw: true,
      help: 'Ask your AI about this drive, or to change it (? works too)',
      usage: 'ai {question} [-n] | ai --open',
      details:
        'Your own assistant, with the drive and page under the terminal. It keeps the conversation until -n starts a new one, and the chat is saved with your AI chats.',
      options: [
        { name: 'new', abbr: 'n', help: 'Start a new chat', boolean: true },
        { name: 'open', abbr: 'o', help: 'Open this chat in the AI sidebar', boolean: true },
      ],
      examples: ['? what does this site do', 'ai add a dark mode to style.css', 'ai -n summarize posts/'],
    },

    // terminal
    {
      name: 'history',
      group: 'terminal',
      help: 'Commands you ran (!! runs the last, !n number n)',
      usage: 'history [text] [-c]',
      options: [{ name: 'clear', abbr: 'c', help: 'Forget them all', boolean: true }],
    },
    { name: 'clear', group: 'terminal', help: 'Clear the screen (Ctrl+L)', usage: 'clear' },
    { name: 'echo', group: 'terminal', help: 'Print what follows', usage: 'echo [text...]' },
    {
      name: 'env',
      group: 'terminal',
      help: 'Terminal variables ($name in a command)',
      subcommands: [
        { name: 'ls', help: 'List the variables', usage: 'env ls' },
        { name: 'get', help: 'Get a variable', usage: 'env get {name}', autocomplete: 'env' },
        { name: 'set', help: 'Set a variable', usage: 'env set {name} {value}', autocomplete: 'env' },
        { name: 'rm', help: 'Remove a variable', usage: 'env rm {name}', autocomplete: 'env' },
      ],
    },
    {
      name: 'term',
      group: 'terminal',
      help: 'Install commands from a site',
      subcommands: [
        { name: 'ls', help: 'List the installed commands', usage: 'term ls' },
        { name: 'install', help: 'Install a site’s commands', usage: 'term install {name} {url}' },
        { name: 'uninstall', help: 'Uninstall them', usage: 'term uninstall {name}' },
      ],
    },
    {
      name: 'system',
      group: 'terminal',
      help: 'Nomad system info',
      subcommands: [
        {
          name: 'fs_audit_stream',
          help: 'Stream the filesystem audit log',
          usage: 'system fs_audit_stream [-c caller] [-t target] [-m method] [-l ms]',
          options: [
            { name: 'caller', abbr: 'c', help: 'Only this caller (URL)' },
            { name: 'target', abbr: 't', help: 'Only this target (URL)' },
            { name: 'method', abbr: 'm', help: 'Only this method' },
            { name: 'longerthan', abbr: 'l', help: 'Only calls that took longer than this (ms)' },
          ],
        },
      ],
    },
    { name: 'reload', group: 'terminal', help: 'Reload the terminal', usage: 'reload' },
    { name: 'exit', group: 'terminal', help: 'Close the terminal (Ctrl+D on an empty line)', usage: 'exit' },
  ],
};
