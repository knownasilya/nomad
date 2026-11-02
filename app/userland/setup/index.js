import './background-run.js';
import './intro.js';
import './license.js';
import './migrating.js';
import './persona.js';

function isStageDone(key) {
  var url = new URL(location.toString());
  return Boolean(+url.searchParams.get(key));
}

customElements.define(
  'setup-app',
  class extends HTMLElement {
    constructor() {
      super();
      this.stages = [];

      if (!isStageDone('profileSetup')) {
        this.stages.push('intro-view');
        this.stages.push('license-view');
        this.stages.push('background-run-view');
        // Last of the profile stages: it marks profileSetup done, made or skipped.
        this.stages.push('persona-view');
        document.body.style.background = '#334';
        document.body.style.transition = 'background 0.5s';
      }
      if (!isStageDone('migrated08to09')) {
        this.stages.push('migrating-view');
      }

      this.stage = 0;
      this.render();
      this.addEventListener('next', this.onNext.bind(this));
    }

    render() {
      if (!this.stages[this.stage]) return;
      this.innerHTML = `<${this.stages[this.stage]} current></${
        this.stages[this.stage]
      }>`;
    }

    async onNext() {
      document.body.style.background = ''; // switch away from the intro's dark bg (index.html's colors)
      this.stage++;
      this.render();
    }
  }
);
