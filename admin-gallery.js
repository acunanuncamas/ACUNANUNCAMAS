'use strict';
(() => {
  const API = 'https://mafia-tacna-api.acunanuncamas.workers.dev';
  const STORAGE = 'gallery-admin-session-token';
  const $ = (id) => document.getElementById(id);
  let token = '';
  let busy = false;
  let queue = [];
  let mediaType = 'photos';
  const listPath = () => mediaType === 'videos' ? '/api/admin/videos' : '/api/admin/gallery';
  const mediaLabel = () => mediaType === 'videos' ? 'videos' : 'fotografías';

  function notify(message, kind = 'success') {
    $('notice').textContent = message;
    $('notice').dataset.kind = kind;
  }
  function saveSession(value) {
    try {
      if (value) sessionStorage.setItem(STORAGE, value);
      else sessionStorage.removeItem(STORAGE);
    } catch (_) { /* The current in-memory session still works. */ }
  }
  function syncControls() {
    document.querySelectorAll('#workspace input, #workspace textarea, #workspace button, #login-form input, #login-form button')
      .forEach((control) => { control.disabled = busy; });
    queue.filter((item) => item.state === 'done').forEach((item) => {
      item.card.querySelectorAll('input, textarea').forEach((field) => { field.disabled = true; });
    });
    $('upload-all').disabled = busy || !queue.some((item) => item.state !== 'done');
    $('queue-summary').textContent = queue.length
      ? queue.filter((item) => item.state === 'done').length + ' de ' + queue.length + ' ' + mediaLabel() + ' subidos.'
      : 'No hay archivos seleccionados.';
    $('drop-zone').setAttribute('aria-disabled', String(busy));
  }
  function setBusy(value) { busy = value; syncControls(); }
  function clearQueue() {
    queue.forEach((item) => URL.revokeObjectURL(item.preview));
    queue = [];
    $('queue').replaceChildren();
    syncControls();
  }
  function endSession() {
    token = '';
    saveSession('');
    $('admin-token').value = '';
    $('workspace').hidden = true;
    $('login-panel').hidden = false;
    $('photo-list').replaceChildren();
    clearQueue();
  }
  function failure(status, data) {
    if (status === 401 || status === 403) {
      endSession();
      return new Error('Acceso no autorizado. Introduce un token válido.');
    }
    return new Error(typeof data?.error === 'string' ? data.error : 'La operación no se completó (HTTP ' + status + ').');
  }
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(API + path, {
        ...options, cache: 'no-store', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch (_) {
        if (response.ok) throw new Error('La API devolvió una respuesta no válida.');
      }
      if (!response.ok || data.success === false) throw failure(response.status, data);
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('La petición tardó demasiado. Actualiza la lista antes de repetir una operación.');
      if (error instanceof TypeError) throw new Error('No se pudo conectar con la API. Revisa la conexión y los permisos CORS del Worker.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function field(parent, labelText, value = '', type = 'text') {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type;
    input.value = value ?? '';
    if (type === 'number') input.step = '1';
    label.append(input);
    parent.append(label);
    return input;
  }
  function imageUrl(photo) {
    if (mediaType === 'videos' && [false, 0, '0', 'false'].includes(photo.active)) return '';
    const raw = mediaType === 'videos' ? (photo.video_url || '/api/gallery/video/' + encodeURIComponent(photo.id)) : (photo.image_url || '/api/gallery/image/' + encodeURIComponent(photo.id));
    try {
      const url = new URL(raw, API);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch (_) { return ''; }
  }
  function makePreview(src, alt) {
    if (mediaType === 'videos') {
      const video = document.createElement('video');
      video.controls = true; video.playsInline = true; video.preload = 'metadata';
      video.setAttribute('aria-label', alt);
      if (src) video.src = src;
      return video;
    }
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }
  function readOrder(input) {
    const value = input.value.trim();
    if (!value) return undefined;
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error('El orden debe ser un número entero.');
    return number;
  }
  function addFiles(files) {
    if (busy || !token) return;
    let rejected = 0;
    for (const file of files) {
      const valid = mediaType === 'videos' ? ['video/mp4', 'video/webm'].includes(file.type) : file.type.startsWith('image/');
      const limit = (mediaType === 'videos' ? 80 : 10) * 1024 * 1024;
      if (!valid || !file.size || file.size > limit) { rejected++; continue; }
      const item = { file, preview: URL.createObjectURL(file), state: 'pending' };
      item.card = document.createElement('article');
      item.card.className = 'photo-card';
      item.card.append(makePreview(item.preview, 'Vista previa de ' + file.name));
      const name = document.createElement('p');
      name.className = 'filename';
      name.textContent = file.name;
      item.card.append(name);
      item.title = field(item.card, 'Título (opcional)');
      item.description = field(item.card, 'Descripción (opcional)', '', 'textarea');
      item.order = field(item.card, 'Orden (opcional)', '', 'number');
      item.progress = document.createElement('progress');
      item.progress.max = 100;
      item.progress.value = 0;
      item.progress.setAttribute('aria-label', 'Progreso de ' + file.name);
      item.status = document.createElement('p');
      item.status.className = 'item-status';
      item.status.setAttribute('role', 'status');
      item.status.textContent = 'Lista para subir';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary';
      remove.textContent = 'Quitar de la cola';
      remove.addEventListener('click', () => {
        if (busy) return;
        URL.revokeObjectURL(item.preview);
        queue = queue.filter((entry) => entry !== item);
        item.card.remove();
        syncControls();
      });
      item.card.append(item.progress, item.status, remove);
      queue.push(item);
      $('queue').append(item.card);
    }
    syncControls();
    if (rejected) notify('Se omitieron ' + rejected + ' archivos por formato o tamaño. ' + (mediaType === 'videos' ? 'Usa MP4/WebM de hasta 80 MB.' : 'Usa imágenes de hasta 10 MB.'), 'error');
  }
  function upload(item) {
    const data = new FormData();
    data.append(mediaType === 'videos' ? 'video' : 'image', item.file);
    data.append('title', item.title.value.trim());
    data.append('description', item.description.value.trim());
    const order = readOrder(item.order);
    if (order !== undefined) data.append('sort_order', String(order));
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', API + listPath());
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.timeout = mediaType === 'videos' ? 600000 : 120000;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          item.progress.value = Math.round(event.loaded / event.total * 100);
          item.status.textContent = item.progress.value === 100
            ? 'Procesando en el servidor…' : 'Subiendo: ' + item.progress.value + '%';
        } else item.progress.removeAttribute('value');
      };
      xhr.onload = () => {
        let response = {};
        try { response = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (_) {
          reject(new Error('Respuesta inesperada. Actualiza la lista antes de reintentar.'));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300 && response.success !== false) resolve(response);
        else reject(failure(xhr.status, response));
      };
      xhr.onerror = () => reject(new Error('Error de conexión o CORS. Revisa la lista antes de reintentar.'));
      xhr.ontimeout = () => reject(new Error('Tiempo de subida agotado. Revisa la lista antes de reintentar.'));
      xhr.send(data);
    });
  }
  async function refreshList() {
    $('list-status').textContent = 'Cargando ' + mediaLabel() + '…';
    try {
      const data = await request(listPath());
      const items = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(items)) throw new Error('Formato de lista administrativa no reconocido.');
      $('photo-list').replaceChildren();
      items.forEach(renderPhoto);
      $('list-status').textContent = items.length ? items.length + ' ' + mediaLabel() + ' en el archivo.' : 'Todavía no hay ' + mediaLabel() + '.';
    } catch (error) {
      $('photo-list').replaceChildren();
      $('list-status').textContent = 'No se pudo actualizar la lista.' + (mediaType === 'videos' ? ' Comprueba que el Worker y la tabla de videos estén instalados.' : '');
      throw error;
    }
  }
  function renderPhoto(photo) {
    if (photo.id === undefined || photo.id === null) return;
    const form = document.createElement('form');
    form.className = 'photo-card';
    form.append(makePreview(imageUrl(photo), photo.title || 'Fotografía'));
    const title = field(form, 'Título', photo.title);
    const description = field(form, 'Descripción', photo.description, 'textarea');
    const order = field(form, 'Orden', photo.sort_order ?? 0, 'number');
    const activeLabel = document.createElement('label');
    activeLabel.className = 'inline';
    const active = document.createElement('input');
    active.type = 'checkbox';
    active.checked = ![false, 0, '0', 'false'].includes(photo.active);
    activeLabel.append(active, document.createTextNode('Visible en la galería pública'));
    form.append(activeLabel);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const save = document.createElement('button');
    save.type = 'submit'; save.textContent = 'Guardar cambios';
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'danger'; remove.textContent = 'Eliminar';
    actions.append(save, remove); form.append(actions);
    const path = listPath() + '/' + encodeURIComponent(photo.id);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      try {
        const body = { title: title.value.trim(), description: description.value.trim(), sort_order: readOrder(order) ?? 0, active: active.checked ? 1 : 0 };
        setBusy(true);
        await request(path, { method: 'PATCH', body: JSON.stringify(body) });
        notify('Cambios guardados.');
        await refreshList();
      } catch (error) { notify(error.message, 'error'); }
      finally { setBusy(false); }
    });
    remove.addEventListener('click', async () => {
      if (busy) return;
      $('delete-title').textContent = photo.title || 'Fotografía #' + photo.id;
      const dialog = $('delete-dialog');
      dialog.returnValue = 'cancel';
      const decision = new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
      dialog.showModal();
      if (await decision !== 'confirm') return;
      setBusy(true);
      try {
        await request(path, { method: 'DELETE' });
        notify(mediaType === 'videos' ? 'Video eliminado.' : 'Fotografía eliminada.');
        await refreshList();
      } catch (error) { notify(error.message, 'error'); }
      finally { setBusy(false); }
    });
    $('photo-list').append(form);
  }
  function updateMediaMode() {
    const videos = mediaType === 'videos';
    $('upload-heading').textContent = videos ? 'Subir videos' : 'Subir fotografías';
    $('upload-kind').textContent = videos ? '02 / NUEVOS VIDEOS' : '01 / NUEVAS IMÁGENES';
    $('drop-heading').textContent = videos ? 'Arrastra tus videos aquí' : 'Arrastra tus fotografías aquí';
    $('drop-help').textContent = videos ? 'MP4 o WebM · máximo 80 MB por video · puedes elegir varios' : 'o pulsa para seleccionarlas · puedes elegir varias';
    $('file-input').accept = videos ? 'video/mp4,video/webm' : 'image/*';
    $('list-heading').textContent = videos ? 'Archivo de videos' : 'Archivo de fotografías';
    $('delete-heading').textContent = videos ? '¿Eliminar video?' : '¿Eliminar fotografía?';
    $('delete-help').textContent = videos ? 'Esta acción elimina el video del archivo.' : 'Esta acción elimina la fotografía del archivo.';
    document.querySelectorAll('[data-admin-media]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.adminMedia === mediaType)));
    syncControls();
  }
  document.querySelectorAll('[data-admin-media]').forEach((button) => button.addEventListener('click', async () => {
    if (busy || button.dataset.adminMedia === mediaType) return;
    if (queue.some((item) => item.state !== 'done') && !confirm('Hay archivos pendientes. ¿Vaciar la cola y cambiar de sección?')) return;
    clearQueue();
    mediaType = button.dataset.adminMedia;
    updateMediaMode();
    $('photo-list').replaceChildren();
    setBusy(true);
    try { await refreshList(); notify('Sección de ' + mediaLabel() + '.'); }
    catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  }));
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    token = $('admin-token').value.trim();
    if (!token) return;
    setBusy(true);
    try {
      await refreshList();
      saveSession($('remember-token').checked ? token : '');
      $('admin-token').value = '';
      $('login-panel').hidden = true; $('workspace').hidden = false;
      notify('Acceso autorizado.');
    } catch (error) { endSession(); notify(error.message, 'error'); }
    finally { setBusy(false); }
  });
  $('logout').addEventListener('click', () => { if (!busy) { endSession(); notify('Sesión cerrada.'); } });
  $('file-input').addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = ''; });
  $('drop-zone').addEventListener('keydown', (event) => {
    if (!busy && event.target === $('drop-zone') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); $('file-input').click(); }
  });
  for (const type of ['dragenter', 'dragover']) $('drop-zone').addEventListener(type, (event) => {
    event.preventDefault(); if (!busy) $('drop-zone').classList.add('is-over');
  });
  $('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('is-over'));
  $('drop-zone').addEventListener('drop', (event) => {
    event.preventDefault(); $('drop-zone').classList.remove('is-over'); addFiles(event.dataTransfer.files);
  });
  $('upload-all').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    let uploaded = 0, failed = 0;
    try {
      for (const item of queue.filter((entry) => entry.state !== 'done')) {
        if (!token) break;
        item.status.textContent = 'Iniciando subida…'; item.progress.value = 0;
        try {
          await upload(item);
          item.state = 'done'; item.progress.value = 100; item.status.textContent = 'Subida completada'; uploaded++;
        } catch (error) { item.state = 'error'; item.status.textContent = error.message; failed++; }
      }
      if (token) {
        await refreshList();
        notify(uploaded + ' ' + mediaLabel() + ' subidos; ' + failed + ' con error.' + (failed ? ' Revisa la lista antes de reintentar.' : ''), failed ? 'error' : 'success');
      } else notify('La sesión expiró. Vuelve a introducir el token.', 'error');
    } catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  });
  $('refresh').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try { await refreshList(); notify('Lista actualizada.'); }
    catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  });
  (async () => {
    try { token = sessionStorage.getItem(STORAGE) || ''; } catch (_) {}
    if (!token) return;
    setBusy(true);
    try { await refreshList(); $('login-panel').hidden = true; $('workspace').hidden = false; }
    catch (error) { endSession(); notify(error.message, 'error'); }
    finally { setBusy(false); }
  })();
})();
