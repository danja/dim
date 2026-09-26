import { esc } from '../../common/http/respond.js'
import { formFields } from '../../common/http/write.js'
import { page, taskPath, titleHtml } from './common.js'

/**
 * Getting Things Diced: the numbered list with targets and chances, a Roll
 * button, and the result. Prints as the paper list the method started as.
 */

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']
const POLICY_TEXT = {
  replace: 'Replace — the picked task leaves the list, the next one moves up',
  skip: 'Skip — keep the list, ignore that number next roll',
  new: 'New list — start again from the full list'
}

function table (list, picked) {
  if (!list.length) return '<p class="muted">Nothing to roll for: no tasks are in To do or Doing without something to wait on.</p>'
  const rows = list.map(e => `<tr${picked?.entry.task.id === e.task.id ? ' class="picked"' : ''}>
<td>${e.rank}</td><td class="target">${e.target}</td><td>${(e.chance * 100).toFixed(1)}%</td><td><a href="${taskPath(e.task)}">${titleHtml(e.task)}</a></td></tr>`).join('')
  return `<table class="dice-list"><caption>Numbered by priority; roll two dice, do the task whose number comes up.</caption>
<thead><tr><th scope="col">#</th><th scope="col">Dice</th><th scope="col">Chance</th><th scope="col">Task</th></tr></thead>
<tbody>${rows}</tbody></table>`
}

function result (picked, session) {
  if (!picked) return ''
  const start = session?.user && picked.entry.task.status !== 'doing'
    ? `<form method="post" action="${taskPath(picked.entry.task)}/move">${formFields(session, taskPath(picked.entry.task))}<input type="hidden" name="status" value="doing"><button>Start it</button></form>`
    : ''
  return `<section class="roll-result" aria-live="polite">
<p class="dice" aria-label="Rolled ${picked.dice.join(' and ')}"><span>${FACES[picked.dice[0] - 1]}</span><span>${FACES[picked.dice[1] - 1]}</span></p>
<p>${picked.sum}${picked.rolls > 1 ? ` <span class="meta">(after ${picked.rolls} rolls — empty numbers roll again)</span>` : ''} → <strong><a href="${taskPath(picked.entry.task)}">${titleHtml(picked.entry.task)}</a></strong></p>
${start}
</section>`
}

function rollForm ({ session, state, picked, policy }) {
  if (!session?.user) return session?.writesEnabled ? '<p class="meta"><a href="/login?return=/farelo/dice">Log in</a> to roll.</p>' : ''
  const hidden = [
    ...state.exclude.map(id => `<input type="hidden" name="exclude" value="${esc(id)}">`),
    ...state.skip.map(t => `<input type="hidden" name="skip" value="${esc(t)}">`),
    picked ? `<input type="hidden" name="lastTask" value="${esc(picked.entry.task.id)}"><input type="hidden" name="lastTarget" value="${picked.entry.target}">` : ''
  ].join('')
  const choices = picked
    ? `<fieldset class="policy"><legend>Next roll</legend>${Object.entries(POLICY_TEXT).map(([p, text]) => `<label><input type="radio" name="policy" value="${p}"${p === policy ? ' checked' : ''}> ${esc(text)}</label>`).join('')}</fieldset>`
    : '<input type="hidden" name="policy" value="new">'
  return `<form class="roll" method="post" action="/farelo/dice">${formFields(session, '/farelo/dice')}${hidden}${choices}<button class="roll-button">🎲 Roll</button></form>`
}

export function renderDicePage ({ list, picked = null, state = { exclude: [], skip: [] }, policy = 'replace', tabs, session }) {
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/farelo/">Tasks</a></nav>
<h1>Getting Things Diced</h1>
${result(picked, session)}
${rollForm({ session, state, picked, policy })}
${table(list, picked)}
<p class="meta noprint">The method: <a href="https://web.archive.org/web/20230321045154/https://hyperdata.it/blog/2015/05/11/getting-things-diced/">Getting Things Diced</a> (Danny Ayers, 2015). Priority 1 gets 7, the likeliest roll; then 6, 8, 5, 9 … · <a href="#" data-print>Print the list</a></p>`
  return page({ title: 'Getting Things Diced', body, tabs, session })
}
