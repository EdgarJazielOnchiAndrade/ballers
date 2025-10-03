/* ==== Toggle del menú (hamburguesa) en móvil ==== */
const btnToggle = document.querySelector('.nav__toggle');
const nav = document.querySelector('#mainnav');

if (btnToggle && nav) {
  btnToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btnToggle.setAttribute('aria-expanded', String(open));
  });

  // Cerrar el panel cuando se hace clic en un enlace (en móvil)
  nav.addEventListener('click', (e) => {
    if (e.target.matches('a') && nav.classList.contains('open')) {
      nav.classList.remove('open');
      btnToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ==== Submenú "Documentación" ==== */
const subToggle = document.querySelector('.submenu__toggle');
const subMenu   = document.querySelector('#doc-submenu');

if (subToggle && subMenu) {
  const closeSubmenu = () => {
    subMenu.classList.remove('open');
    subMenu.setAttribute('hidden', '');
    subToggle.setAttribute('aria-expanded', 'false');
  };

  subToggle.addEventListener('click', () => {
    const willOpen = !subMenu.classList.contains('open');
    if (willOpen) {
      subMenu.classList.add('open');
      subMenu.removeAttribute('hidden');
      subToggle.setAttribute('aria-expanded', 'true');
    } else {
      closeSubmenu();
    }
  });

  // Cerrar al hacer clic fuera
  document.addEventListener('click', (e) => {
    if (!subMenu.contains(e.target) && !subToggle.contains(e.target)) closeSubmenu();
  });

  // Cerrar con Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSubmenu();
  });
}

/* ==== Chips de filtros (solo marca activo por ahora) ==== */
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    // Aquí luego filtrarás productos por categoría con JS
  });
});

/* (Opcional) Evitar recargar en el buscador por ahora */
const searchForm = document.querySelector('.search');
if (searchForm) searchForm.addEventListener('submit', e => e.preventDefault());
