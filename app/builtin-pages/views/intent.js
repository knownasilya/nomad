/* globals */

import * as yo from 'yo-yo'
import renderBuiltinPagesNav from '../com/builtin-pages-nav'

// globals
// =

var services = []
var qps = window.location.search

update()
setup()

async function setup () {
  await loadServices()
  update()
}

// rendering
// =

function update () {
  yo.update(document.querySelector('.window-content.intent'), yo`
    <div class="window-content builtin intent">
      <div class="builtin-wrapper intent-wrapper">
        ${renderHeader()}

        <div class="builtin-main">
          ${renderServices()}
        </div>
      </div>
    </div>
  `)
}

function renderHeader () {
  return yo`
    <div class="builtin-header fixed">
      ${renderBuiltinPagesNav('Intents')}
    </div>`
}

function renderServices () {
  return yo`
    <div class="services-container">
      ${services.length ? yo`
        <h2 class="subtitle-heading">
          <span>Share Services</span>
          <button class="btn transparent add-pinned-btn" data-tooltip="Add share service">
            <i class="fa fa-plus"></i>
          </button>
        </h2>`
      : ''}

      <div class="services">
        ${services.map(renderService)}
      </div>
    </div>
  `
}

function renderService (serviceItem) {
  const {href, title} = serviceItem

  return yo`
    <a class="service" href=${href + qps}>
      <img src=${'beaker-favicon:32,' + href} class="favicon"/>
      <div class="title">${title}</div>
    </a>
  `
}

// helpers
// =

async function loadServices () {
  services = [
    { title: 'Fritter', href: 'dat://fritter.hashbase.io/' },
    { title: 'PasteDat', href: 'dat://pastedat-taravancil.hashbase.io/' },
    { title: 'Twitter', href: 'https://twitter.com/share' }
  ]
}
