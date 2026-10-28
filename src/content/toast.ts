// Optional in-page nudge, rendered in a shadow root so page CSS can't break it.

export interface ToastRequest {
  id: string;
  title: string;
  message: string;
  buttons: string[];
}

const AUTO_HIDE_MS = 15_000;

export function showToast(t: ToastRequest) {
  document.getElementById('tab-resume-toast')?.remove();

  const host = document.createElement('div');
  host.id = 'tab-resume-toast';
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });

  root.innerHTML = `
    <style>
      .card { font: 13px/1.4 system-ui, -apple-system, sans-serif; width: 300px; background: #fff; color: #1c1917;
              border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.16); padding: 14px 14px 12px; border-top: 4px solid #fde047;
              animation: in .2s ease-out; }
      @keyframes in { from { transform: translateY(-8px); opacity: 0 } to { transform: none; opacity: 1 } }
      .title { font-weight: 600; margin: 0 22px 4px 0; }
      .msg { opacity: .85; margin: 0 0 10px; }
      .row { display: flex; gap: 8px; }
      button { font: inherit; border: 0; border-radius: 8px; padding: 6px 10px; cursor: pointer; background: #fffbeb; color: #1c1917; border: 1px solid #fef3c7; }
      button.primary { background: #fef08a; border-color: #facc15; color: #1c1917; font-weight: 700; }
      .x { position: absolute; top: 8px; right: 10px; background: none; border: 0; padding: 2px 6px; color: inherit; opacity: .6; }
    </style>
    <div class="card" style="position:relative">
      <button class="x" aria-label="Close">✕</button>
      <p class="title"></p>
      <p class="msg"></p>
      <div class="row"></div>
    </div>`;

  root.querySelector('.title')!.textContent = t.title;
  root.querySelector('.msg')!.textContent = t.message;
  const row = root.querySelector('.row')!;
  t.buttons.forEach((label, i) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (i === 0) b.className = 'primary';
    b.onclick = () => act(i);
    row.appendChild(b);
  });
  root.querySelector<HTMLButtonElement>('.x')!.onclick = () => host.remove();

  function act(index: number) {
    host.remove();
    try {
      chrome.runtime.sendMessage({ type: 'notifAction', id: t.id, index }).catch(() => {});
    } catch {
      // extension reloaded
    }
  }

  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), AUTO_HIDE_MS);
}
