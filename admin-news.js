'use strict';
// Shares the existing admin session, request helper and operation lock.
window.createNewsAdmin = ({ request, setBusy, isBusy, notify, hasSession }) => {
  const create = document.getElementById('news-create');
  const list = document.getElementById('news-list');
  const status = document.getElementById('news-list-status');
  const refreshButton = document.getElementById('news-refresh');
  const types = [['principal', 'Principal / grande'], ['mediana', 'Mediana'], ['pequena', 'Pequeña'], ['tipografica', 'Tipográfica']];
  const objectUrls = new Set();
  let generation = 0;
  const revoke = () => { objectUrls.forEach((url) => URL.revokeObjectURL(url)); objectUrls.clear(); };
  function field(form, text, name, type, value = '') {
    const label = document.createElement('label'); label.textContent = text;
    const input = document.createElement(type === 'select' ? 'select' : 'input');
    if (type === 'select') types.forEach(([value, text]) => { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); });
    else input.type = type;
    input.name = name; input.value = value ?? '';
    if (type === 'select') Array.from(input.options).forEach((option) => { option.defaultSelected = option.value === input.value; });
    else if (type !== 'file') input.defaultValue = input.value;
    label.append(input); form.append(label); return input;
  }
  async function preview(form, row, version) {
    if (!row.has_image) return;
    const image = document.createElement('img'); image.alt = 'Imagen de ' + row.title;
    try {
      const blob = await request('/api/admin/news/' + row.id + '/image', { raw: true });
      if (version !== generation || !hasSession()) return;
      const url = URL.createObjectURL(blob); objectUrls.add(url); image.src = url; form.prepend(image);
    } catch (_) {
      if (version !== generation) return;
      const message = document.createElement('p'); message.textContent = 'No se pudo cargar la imagen de vista previa.'; form.prepend(message);
    }
  }
  function makeForm(row = null) {
    const form = document.createElement('form'); form.className = 'photo-card news-editor';
    const heading = document.createElement('h3'); heading.textContent = row ? 'Noticia #' + row.id + (row.published ? ' · Publicada' : ' · Borrador') : 'Crear noticia'; form.append(heading);
    const title = field(form, 'Titular', 'title', 'text', row?.title); title.required = true; title.maxLength = 300;
    const url = field(form, 'URL externa (HTTP/HTTPS)', 'url', 'url', row?.url); url.required = true; url.maxLength = 2048;
    field(form, 'Fecha (opcional)', 'date', 'date', row?.date);
    field(form, 'Tipo visual', 'visual_type', 'select', row?.visual_type || 'mediana');
    const order = field(form, 'Orden (menor primero)', 'sort_order', 'number', row?.sort_order ?? 0); order.required = true; order.step = '1'; order.min = '-2147483647'; order.max = '2147483647';
    const image = field(form, row?.has_image ? 'Reemplazar imagen (opcional)' : 'Imagen (opcional)', 'image', 'file'); image.accept = 'image/jpeg,image/png,image/webp,image/gif';
    const help = document.createElement('p'); help.className = 'item-status'; help.textContent = 'JPG, PNG, WebP o GIF · hasta 10 MB. El tipo tipográfico no muestra la imagen en la portada.'; form.append(help);
    const checkbox = (text, name, checked) => {
      const label = document.createElement('label'); label.className = 'inline';
      const input = document.createElement('input'); input.type = 'checkbox'; input.name = name; input.checked = Boolean(checked); input.value = '1';
      label.append(input, document.createTextNode(text)); form.append(label); return input;
    };
    const published = checkbox('Publicada', 'published', row?.published);
    const removeImage = row?.has_image ? checkbox('Quitar imagen actual', 'remove_image', false) : null;
    const actions = document.createElement('div'); actions.className = 'actions';
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = row ? 'Guardar cambios' : 'Crear noticia'; actions.append(save);
    if (row) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger'; remove.textContent = 'Eliminar'; actions.append(remove);
      remove.addEventListener('click', async () => {
        if (isBusy() || !hasSession() || !confirm('¿Eliminar la noticia «' + row.title + '» y su imagen?')) return;
        setBusy(true);
        try { await request('/api/admin/news/' + row.id, { method: 'DELETE' }); if (hasSession()) { await refresh(); notify('Noticia eliminada.'); } }
        catch (error) { notify(error.message, 'error'); }
        finally { setBusy(false); }
      });
    }
    form.append(actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (isBusy() || !hasSession()) return;
      const file = image.files[0];
      if (file && (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024)) { notify('Usa una imagen JPG, PNG, WebP o GIF de hasta 10 MB.', 'error'); return; }
      if (file && removeImage?.checked) { notify('Elige reemplazar o quitar la imagen, no ambas opciones.', 'error'); return; }
      const body = new FormData(form);
      if (!file) body.delete('image');
      body.set('published', published.checked ? '1' : '0');
      body.set('remove_image', removeImage?.checked ? '1' : '0');
      setBusy(true);
      try {
        await request('/api/admin/news' + (row ? '/' + row.id : ''), { method: row ? 'PATCH' : 'POST', body });
        if (hasSession()) { if (!row) form.reset(); await refresh(); notify(row ? 'Noticia actualizada.' : 'Noticia creada.'); }
      } catch (error) { notify(error.message, 'error'); }
      finally { setBusy(false); }
    });
    return form;
  }
  async function refresh() {
    if (!hasSession()) return;
    const version = ++generation;
    status.textContent = 'Cargando noticias…';
    try {
      const data = await request('/api/admin/news');
      if (version !== generation || !hasSession()) return;
      if (!Array.isArray(data.items)) throw new Error('Respuesta de noticias inválida.');
      revoke(); list.replaceChildren();
      data.items.forEach((row) => { const form = makeForm(row); list.append(form); void preview(form, row, version); });
      status.textContent = data.items.length ? data.items.length + ' noticias · Publica las que quieras mostrar en la web.' : 'Todavía no hay noticias. Crea la primera arriba.';
    } catch (error) { if (version === generation) status.textContent = 'No se pudo cargar el archivo. ' + error.message; throw error; }
  }
  create.append(makeForm());
  refreshButton.addEventListener('click', async () => {
    if (isBusy() || !hasSession()) return;
    setBusy(true);
    try { await refresh(); } catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  });
  return { refresh, reset() { generation++; revoke(); list.replaceChildren(); create.replaceChildren(makeForm()); status.textContent = ''; } };
};
