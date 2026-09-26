/* eslint-env browser */
// Small enhancements for every page. Pages work without them.

// Scroll the current tab into view so it is never hidden off the edge.
const current = document.querySelector('.tabs [aria-current="page"]')
if (current) current.scrollIntoView({ block: 'nearest', inline: 'center' })

// Ask before destructive forms (data-confirm="…").
document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-confirm]')
  if (form && !confirm(form.dataset.confirm)) e.preventDefault()
})

// Links that print the page (data-print).
document.addEventListener('click', e => {
  if (e.target.closest('[data-print]')) {
    e.preventDefault()
    window.print()
  }
})
