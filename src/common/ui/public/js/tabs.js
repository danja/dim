// Progressive enhancement for the tab row: on narrow screens, scroll the
// current tab into view so it is never hidden off the right edge.
const current = document.querySelector('.tabs [aria-current="page"]')
if (current) current.scrollIntoView({ block: 'nearest', inline: 'center' })
