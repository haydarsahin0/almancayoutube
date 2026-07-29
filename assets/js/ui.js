// Basit modal yönetimi
import { $ } from './util.js';

export function showModal(title, node) {
  $('#modal-title').textContent = title;
  const b = $('#modal-body');
  b.replaceChildren(node);
  b.scrollTop = 0;
  $('#modal-backdrop').hidden = false;
}
export function closeModal() { $('#modal-backdrop').hidden = true; }

export function initModal() {
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal-backdrop').hidden) closeModal(); });
}
