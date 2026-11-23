for (const button of document.querySelectorAll('.copy')) {
  const label = button.textContent;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.url);
      button.textContent = 'Copied';
      button.closest('details')?.removeAttribute('open');
      setTimeout(() => { button.textContent = label; }, 1800);
    } catch {
      prompt('Copy this link:', button.dataset.url);
    }
  });
}

document.addEventListener('click', event => {
  for (const menu of document.querySelectorAll('.file-menu[open]')) {
    if (!menu.contains(event.target)) menu.open = false;
  }
});

const form = document.querySelector('#upload-form');
if (form) {
  const input = document.querySelector('#files');
  const picker = document.querySelector('.file-picker');
  const chosen = document.querySelector('#chosen');
  const button = document.querySelector('#upload-button');
  const progressWrap = document.querySelector('#upload-progress');
  const progressBar = document.querySelector('#progress-bar');
  const progressLabel = document.querySelector('#progress-label');
  const progressPercent = document.querySelector('#progress-percent');
  const errorBox = document.querySelector('#upload-error');
  const csrf = form.querySelector('[name="csrf"]').value;
  const folderId = form.querySelector('[name="folder_id"]').value || null;
  const maxFile = 2 * 1024 * 1024 * 1024;
  const chunkSize = 8 * 1024 * 1024;

  input.addEventListener('change', () => {
    chosen.textContent = [...input.files].map(file => file.name).join(', ') || 'Up to 2 GB per file.';
  });
  for (const eventName of ['dragenter', 'dragover']) picker.addEventListener(eventName, event => {
    event.preventDefault(); picker.classList.add('dragging');
  });
  for (const eventName of ['dragleave', 'drop']) picker.addEventListener(eventName, event => {
    event.preventDefault(); picker.classList.remove('dragging');
  });
  picker.addEventListener('drop', event => {
    if (!event.dataTransfer.files.length) return;
    input.files = event.dataTransfer.files;
    input.dispatchEvent(new Event('change'));
  });

  async function api(path, body) {
    const response = await fetch(path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Server returned ${response.status}`);
    return data;
  }

  function sendChunk(id, offset, blob, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/uploads/${encodeURIComponent(id)}/chunks`);
      xhr.setRequestHeader('X-CSRF-Token', csrf);
      xhr.setRequestHeader('X-Upload-Offset', String(offset));
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded); };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `Server returned ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Connection lost during upload.'));
      xhr.send(blob);
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const files = [...input.files];
    if (!files.length) return;
    errorBox.hidden = true;
    if (files.some(file => file.size > maxFile)) {
      errorBox.textContent = 'Each file must be 2 GB or smaller.';
      errorBox.hidden = false;
      return;
    }
    button.disabled = true;
    progressWrap.hidden = false;
    const total = files.reduce((sum, file) => sum + file.size, 0);
    let completed = 0;
    const update = value => {
      const percent = total ? Math.min(99, Math.floor(value / total * 100)) : 99;
      progressBar.value = percent;
      progressPercent.textContent = `${percent}%`;
    };
    try {
      for (const file of files) {
        progressLabel.textContent = `Uploading ${file.name}`;
        const upload = await api('/api/uploads', { name: file.name, size: file.size, folder_id: folderId });
        for (let offset = 0; offset < file.size; offset += chunkSize) {
          const blob = file.slice(offset, offset + chunkSize);
          await sendChunk(upload.id, offset, blob, sent => update(completed + offset + sent));
          update(completed + Math.min(offset + chunkSize, file.size));
        }
        progressLabel.textContent = `Finishing ${file.name}`;
        await api(`/api/uploads/${encodeURIComponent(upload.id)}/finish`);
        completed += file.size;
      }
      progressBar.value = 100;
      progressPercent.textContent = '100%';
      progressLabel.textContent = 'Done. Refreshing your files…';
      window.location.reload();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      progressLabel.textContent = 'Upload stopped';
      button.disabled = false;
    }
  });
}
