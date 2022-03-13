customElements.define(
  'intro-view',
  class extends HTMLElement {
    constructor() {
      super();
      let shadow = this.attachShadow({ mode: 'open' });
      this.render(shadow);
      shadow.querySelector('a').addEventListener('click', (e) => {
        this.setAttribute('fadeout', true);
        setTimeout(() => {
          this.dispatchEvent(
            new CustomEvent('next', { bubbles: true, composed: true })
          );
        }, 500);
      });
    }

    render(shadow) {
      shadow.innerHTML = `
<img id="logo" src="beaker://assets/logo-ondark">
<h1><span>Welcome</span> <span>to</span> <span>Nomad</span></h1>
<a>Get Started &gt;</a>
<style>
  :host {
    -webkit-app-region: drag;
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    width: 100vw;
    background: #334;
    color: #fff;
    transition: opacity 0.5s;
  }
  :host([fadeout]) {
    opacity: 0;
  }
  h1 {
    position: fixed;
    left: 0;
    top: 325px;
    width: 100%;
    text-align: center;
  }
  h1 span {
    opacity: 0;
    animation: fade-in 2s 1;
    animation-fill-mode: forwards;
    animation-timing-function: cubic;
  }
  h1 span:nth-child(1) {
    animation-delay: 2s;
    font-weight: normal;
    color: #bbf;
  }
  h1 span:nth-child(2) {
    animation-delay: 2.6s;
    font-weight: normal;
    color: #bbf;
  }
  h1 span:nth-child(3) {
    animation-delay: 3.2s;
    color: #eef;
    text-shadow: 0 0 3px #99ff;
  }
  a {
    position: fixed;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 21px;
    font-weight: 200;
    color: #dfdfff;
    cursor: pointer;
    animation: fade-in 2s 1;
    animation-fill-mode: forwards;
    animation-timing-function: cubic;
    animation-delay: 3.8s;
    -webkit-app-region: no-drag;
  }
  a:hover {
    text-decoration: underline;
  }
  #logo {
    position: fixed;
    left: 50%;
    top: 50px;
    transform: translateX(-50%);
    width: 250px;
    height: 250px;
  }
</style>
    `;
    }
  }
);
