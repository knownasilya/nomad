import { BaseSlideView } from './base-slide-view.js';

// The onboarding step that makes the user's first Persona (ADR-0031): who they are when a site asks
// them to log in. The first Persona becomes the default, so the user's first Space (Personal) uses
// it, and so does every Space they make until they pick another there. It can be skipped; My Library
// → Personas and the login prompt make one later. The fields and wording follow My Library →
// Personas (userland/library/js/views/personas.js), and it calls the same nomad.personas.create.
//
// This is the last profile stage, so it marks `profileSetup` done (made or skipped). A user who
// already has a Persona (a profile that ran setup again) never sees the form.

const MAX_THUMB = 2 * 1024 * 1024;

customElements.define(
  'persona-view',
  class extends BaseSlideView {
    constructor() {
      super();
      this.thumb = '';
      this.busy = false;
      this.$ = (sel) => this.shadowRoot.querySelector(sel);
      this.$('form').addEventListener('submit', (e) => this.onMake(e));
      this.$('.skip').addEventListener('click', () => this.finish());
      this.$('input[type=file]').addEventListener('change', (e) => this.onPickThumb(e));
      this.$('.avatar-btn').addEventListener('click', () => this.$('input[type=file]').click());
      for (const el of this.shadowRoot.querySelectorAll('input:not([type=file]), textarea')) {
        el.addEventListener('input', () => this.update());
      }
      this.load();
    }

    async load() {
      try {
        const st = await nomad.personas.list();
        if (st?.personas?.length) return this.finish({ immediate: true });
        const first = st?.spaces?.[0];
        if (first) {
          this.$('.space-name').textContent = first.name;
          if (first.color) this.$('.space .dot').style.background = first.color;
        }
      } catch {}
      setTimeout(() => this.$('.title-input').focus(), 300);
    }

    update() {
      const title = this.$('.title-input').value.trim();
      const email = this.$('.email-input').value.trim();
      const badEmail = !!email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      this.$('.email-input').classList.toggle('bad', badEmail);
      this.$('.make').disabled = this.busy || !title || badEmail;
      if (!this.thumb) this.$('.avatar-initial').textContent = title ? title.slice(0, 1).toUpperCase() : '';
      this.$('.avatar-btn').classList.toggle('empty', !this.thumb && !title);
      this.setError('');
    }

    setError(msg) {
      this.$('.error').textContent = msg;
      this.$('.error').hidden = !msg;
    }

    onPickThumb(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_THUMB) return this.setError('Pick a picture under 2 MB');
      const reader = new FileReader();
      reader.onload = () => {
        this.thumb = reader.result;
        this.$('.avatar-img').src = this.thumb;
        this.$('.avatar-btn').classList.add('has-img');
        this.$('.avatar-btn').title = 'Change picture';
        this.update();
      };
      reader.readAsDataURL(file);
    }

    async onMake(e) {
      e.preventDefault();
      if (this.$('.make').disabled) return;
      const title = this.$('.title-input').value.trim();
      const label = this.$('.label-input').value.trim();
      this.busy = true;
      this.$('.make').textContent = 'Making…';
      this.$('.skip').disabled = true;
      this.update();
      try {
        await nomad.personas.create({
          label: label || 'Me',
          title,
          description: this.$('.about-input').value.trim(),
          email: this.$('.email-input').value.trim(),
          thumb: this.thumb || undefined,
        });
        this.finish();
      } catch (err) {
        this.busy = false;
        this.$('.make').textContent = 'Make Persona';
        this.$('.skip').disabled = false;
        this.update();
        this.setError(
          String(err?.message || err)
            .replace(/^Error invoking remote method '[^']+': /, '')
            .replace(/^Error: /, '')
        );
      }
    }

    async finish({ immediate = false } = {}) {
      if (this.done) return;
      this.done = true;
      await nomad.browser.updateSetupState({ profileSetup: 1 }).catch(() => {});
      if (!immediate) this.setAttribute('fadeout', true);
      setTimeout(
        () => this.dispatchEvent(new CustomEvent('next', { bubbles: true, composed: true })),
        immediate ? 0 : 500
      );
    }

    render() {
      return `
<style>
:host {
  opacity: 0;
  transition: opacity 1s;
  overflow-y: auto;
}
:host([fadein]) {
  opacity: 1;
}
:host([fadeout]) {
  opacity: 0;
}
h1 {
  margin-top: 26px;
}
h1 strong {
  font-size: 32px;
}
.intro {
  font-size: 15px;
  line-height: 1.45;
  color: var(--text-color--light, #667);
  margin: 8px 0 18px;
}
.space {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.space .dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #6c6cff;
}
form {
  -webkit-app-region: no-drag;
}
.row {
  display: flex;
  gap: 14px;
  margin-bottom: 12px;
}
.row > label {
  flex: 1;
  min-width: 0;
}
label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color--default, #333);
}
.hint {
  font-weight: 400;
  color: var(--text-color--pretty-light, #889);
}
input:not([type=file]),
textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 5px;
  padding: 0 10px;
  height: 34px;
  font: inherit;
  font-size: 14px;
  font-weight: 400;
  color: var(--text-color--default, #333);
  background: var(--bg-color--default, #fff);
  border: 1px solid var(--border-color--light, #ccd);
  border-radius: 6px;
}
textarea {
  height: 52px;
  padding: 7px 10px;
  resize: none;
}
input:focus,
textarea:focus {
  outline: 0;
  border-color: var(--text-color--link, #4040e7);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--text-color--link, #4040e7) 25%, transparent);
}
input.bad {
  border-color: #d93f3f;
}
input[type=file] {
  display: none;
}
.avatar-btn {
  flex: 0 0 auto;
  position: relative;
  align-self: flex-end;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 0;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  background: var(--text-color--link, #4040e7);
  color: #fff;
  font-size: 22px;
  font-weight: 600;
}
.avatar-btn .fa-camera,
.avatar-btn .avatar-img {
  display: none;
}
.avatar-btn.empty .fa-camera {
  display: inline;
  font-size: 18px;
}
.avatar-btn.has-img .avatar-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-btn.has-img .avatar-initial {
  display: none;
}
.avatar-btn:focus-visible {
  outline: 2px solid var(--text-color--link, #4040e7);
  outline-offset: 2px;
}
.error {
  color: #d93f3f;
  font-size: 13px;
  margin: -2px 0 8px;
}
.footer {
  position: fixed;
  left: 20px;
  right: 20px;
  bottom: 22px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.footer .note {
  flex: 1;
  font-size: 12px;
  color: var(--text-color--pretty-light, #889);
}
button.skip,
button.make {
  -webkit-app-region: no-drag;
  height: 36px;
  padding: 0 16px;
  border-radius: 6px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
button.skip {
  background: transparent;
  color: var(--text-color--lightish, #555);
  border: 1px solid var(--border-color--light, #ccd);
}
button.skip:hover {
  background: var(--bg-color--semi-light, #f0f0f6);
}
button.make {
  background: var(--text-color--link, #4040e7);
  border: 1px solid var(--text-color--link, #4040e7);
  color: #fff;
  font-weight: 500;
}
button.make:disabled,
button.skip:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
<h1><strong>Who are you online?</strong></h1>
<p class="intro">
  Make a Persona: the name and picture a site sees when it asks you to log in and you say yes.
  It’s who you are in your <span class="space"><span class="dot"></span><span class="space-name">Personal</span></span>
  space and any new one, and you can make more later.
</p>
<form autocomplete="off">
  <div class="row">
    <button type="button" class="avatar-btn empty" title="Add a picture" aria-label="Add a picture">
      <span class="fas fa-camera"></span>
      <span class="avatar-initial"></span>
      <img class="avatar-img" alt="" />
    </button>
    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
    <label>Name <span class="hint">What sites see</span>
      <input class="title-input" placeholder="Ada Lovelace" maxlength="280" />
    </label>
    <label>Label <span class="hint">Only you see it</span>
      <input class="label-input" placeholder="Me" maxlength="40" />
    </label>
  </div>
  <div class="row">
    <label>About <span class="hint">Optional, also public</span>
      <textarea class="about-input" maxlength="1000" placeholder="A few words about you"></textarea>
    </label>
  </div>
  <div class="row">
    <label>Email <span class="hint">Optional and private. A site gets it only when you say yes.</span>
      <input class="email-input" type="email" placeholder="you@example.com" maxlength="254" />
    </label>
  </div>
  <div class="error" hidden></div>
  <div class="footer">
    <span class="note">It’s a profile drive of your own, kept on your devices.</span>
    <button type="button" class="skip">Skip for now</button>
    <button type="submit" class="make" disabled>Make Persona</button>
  </div>
</form>
    `;
    }
  }
);
