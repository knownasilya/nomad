function h (tag, attrs, ...children) {
  var el = document.createElement(tag)
  for (let k in attrs) {
    if (typeof attrs[k] === 'function') {
      el.addEventListener(k, attrs[k])
    } else {
      el.setAttribute(k, attrs[k])
    }
  }
  for (let child of children) el.append(child)
  return el
}

customElements.define('photo-album-app', class extends HTMLElement {
  constructor () {
    super()
    this.siteInfo = undefined
    this.photos = []
  }

  connectedCallback () {
    this.load()
  }

  async load () {
    this.siteInfo = await nomad.fs.getInfo()
    this.photos = await nomad.fs.readdir('/photos').catch(e => ([]))

    this.append(h('header', {}, 
      h('h1', {},
        this.siteInfo.title || 'Untitled Photo Album',
        ' ',
        this.siteInfo.writable
          ? h('small', {}, h('a', {href: '#', click: this.onEditInfo.bind(this)}, 'edit'))
          : ''
      ),
      (this.siteInfo.description)
        ? h('p', {}, this.siteInfo.description)
        : '',
      this.siteInfo.writable
        ? h('button', {click: this.onAdd.bind(this)}, '+ Add Photo')
        : '',
      h('input', {type: 'file', accept: '.jpg,.jpeg,.png', change: this.onSelectAdded.bind(this)})
    ))
    this.append(h('div', {class: 'photos'}))
    this.renderPhotos()
  }

  renderPhotos () {
    var container = this.querySelector('.photos')
    container.innerHTML = ''
    for (let photo of this.photos) {
      container.append(
        h('div', {class: 'photo', click: e => this.doViewModal(e, photo)},
          h('img', {src: `/photos/${photo}`, alt: photo})
        )
      )
    }
    if (this.photos.length === 0) {
      container.append(h('div', {class: 'empty'}, 'This album has no photos'))
    }
  }

  onAdd () {
    this.querySelector('input[type="file"]').click()
  }

  onSelectAdded (e) {
    var file = e.currentTarget.files[0]
    if (!file) return
    var fr = new FileReader()
    fr.onload = async () => {
      var ext = file.name.split('.').pop()
      var name = `${Date.now()}.${ext}`
      await nomad.fs.mkdir('/photos').catch(e => undefined)
      await nomad.fs.writeFile(`/photos/${name}`, fr.result, 'binary')
      this.photos.push(name)
      this.renderPhotos()

    }
    fr.readAsArrayBuffer(file)
  }
  
  async onEditInfo (e) {
    e.preventDefault()
    await nomad.shell.drivePropertiesDialog(location.toString())
    location.reload()
  }

  async doViewModal (e, photo) {
    e.stopPropagation()
    await this.openModal(this.photos.indexOf(photo))
  }

  async openModal (index) {
    this._openingIndex = index

    var existingDialog = this.querySelector('dialog')
    if (existingDialog) {
      existingDialog.close()
      existingDialog.remove()
    }

    var photo = this.photos[index]

    var prevBtn = h('button', {class: 'nav-btn prev-btn', click: e => { e.stopPropagation(); this.openModal(index - 1) }}, '❮')
    var nextBtn = h('button', {class: 'nav-btn next-btn', click: e => { e.stopPropagation(); this.openModal(index + 1) }}, '❯')
    if (index === 0) prevBtn.disabled = true
    if (index === this.photos.length - 1) nextBtn.disabled = true

    var descriptionEl = h('div', {class: 'description'}, h('em', {}, ''))
    var textarea = h('textarea', {})

    var dialog = h('dialog', {},
      h('div', {},
        h('div', {class: 'img-wrap'},
          prevBtn,
          h('img', {src: `/photos/${photo}`}),
          nextBtn
        ),
        h('div', {},
          this.siteInfo.writable
            ? h('div', {class: 'ctrls'},
              h('button', {class: 'red', click: onDelete}, 'Delete Photo')
            )
            : '',
          descriptionEl,
          this.siteInfo.writable
            ? h('div', {class: 'description'}, h('a', {href: '#', click: onShowEditDescription}, 'Edit'))
            : '',
          h('form', {class: 'edit-description'},
            textarea,
            h('div', {class: 'form-actions'},
              h('button', {class: 'noborder', click: onHideEditDescription}, 'Cancel'),
              h('button', {click: onSaveEditDescription}, 'Save')
            )
          )
        )
      )
    )

    function onShowEditDescription (e) {
      e.preventDefault()
      dialog.classList.add('editing-description')
      textarea.focus()
    }

    function onHideEditDescription (e) {
      e.preventDefault()
      dialog.classList.remove('editing-description')
    }

    async function onSaveEditDescription (e) {
      e.preventDefault()
      dialog.classList.remove('editing-description')
      var desc = textarea.value
      descriptionEl.textContent = desc
      await nomad.fs.updateMetadata(`/photos/${photo}`, {description: desc})
    }

    async function onDelete (e) {
      if (!confirm('Delete this photo?')) {
        return
      }
      await nomad.fs.unlink(`/photos/${photo}`)
      location.reload()
    }

    const onKeyDown = (e) => {
      if (e.key === 'ArrowLeft' && index > 0) this.openModal(index - 1)
      if (e.key === 'ArrowRight' && index < this.photos.length - 1) this.openModal(index + 1)
    }
    document.addEventListener('keydown', onKeyDown)
    dialog.addEventListener('close', () => document.removeEventListener('keydown', onKeyDown))

    this.append(dialog)
    dialog.showModal()

    // Load description after dialog is visible so the backdrop never flashes
    var description = (await nomad.fs.stat(`/photos/${photo}`).catch(e => {}))?.metadata?.description
    if (this._openingIndex !== index) return
    descriptionEl.innerHTML = ''
    descriptionEl.append(description ? description : h('em', {}, 'No description'))
    textarea.value = description || ''
  }
})

document.body.addEventListener('click', e => {
  var existingDialog = document.querySelector('dialog')
  if (existingDialog && e.target === existingDialog) {
    existingDialog.close()
    existingDialog.remove()
  }
})