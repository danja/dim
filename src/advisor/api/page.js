import { esc } from '../../common/http/respond.js'
import { formFields } from '../../common/http/write.js'
import { page, taskPath, titleHtml, metaLine } from '../../farelo/api/common.js'
import { FEATURES, DEFAULT_WEIGHTS } from '../score.js'
import { MINUTES } from '../Advisor.js'

/** "What next?" — the suggestions, why, what's related, and feedback buttons. */

const LABELS = Object.freeze({ priority: 'Priority', due: 'Due soon', underway: 'Under way', fits: 'Fits your time', context: 'Your context', unblocks: 'Unblocks others', ready: 'Resources ready', age: 'Waiting long', skipped: 'Skipped lately', dormant: 'Quiet project' })

export function contextQuery ({ minutes, context }) {
  const p = new URLSearchParams()
  if (minutes) p.set('minutes', minutes)
  if (context) p.set('context', context)
  const s = p.toString()
  return s ? `?${s}` : ''
}

function contextForm ({ minutes, context, contexts }) {
  const minuteOptions = [['', 'any time'], ...MINUTES.map(m => [m, m < 60 ? `${m} min` : `${m / 60} h`])]
    .map(([v, l]) => `<option value="${v}"${String(minutes ?? '') === String(v) ? ' selected' : ''}>${l}</option>`).join('')
  const contextOptions = [['', 'anywhere'], ...contexts.map(c => [c, c])]
    .map(([v, l]) => `<option value="${esc(v)}"${(context ?? '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')
  return `<form class="next-context" method="get" action="/farelo/next">
<label>I have <select name="minutes">${minuteOptions}</select></label>
<label>at <select name="context">${contextOptions}</select></label>
<button>Suggest</button>
</form>`
}

function reasonList (reasons) {
  if (!reasons.length) return '<p class="meta">No particular reason — it’s simply eligible.</p>'
  return `<ul class="reasons">${reasons.map(r => `<li class="${r.points < 0 ? 'minus' : 'plus'}"><span class="points">${r.points > 0 ? '+' : '−'}${Math.abs(r.points).toFixed(1)}</span> ${esc(r.text)}</li>`).join('')}</ul>`
}

function feedback ({ item, position, shown, query, session }) {
  if (!session?.user) return ''
  const hidden = `${formFields(session, '')}<input type="hidden" name="shown" value="${esc(shown.join(','))}"><input type="hidden" name="rank" value="${position + 1}"><input type="hidden" name="minutes" value="${esc(query.minutes ?? '')}"><input type="hidden" name="context" value="${esc(query.context ?? '')}">`
  return `<div class="next-actions">
<form method="post" action="/farelo/next/${esc(item.task.id)}/accept">${hidden}<button>${item.task.status === 'doing' ? 'Carry on with this' : 'Do this now'}</button></form>
<form method="post" action="/farelo/next/${esc(item.task.id)}/skip">${hidden}<button class="secondary">Not now</button></form>
</div>`
}

function relatedList (related) {
  if (!related?.length) return ''
  return `<div class="related"><h3>To hand</h3><ul>${related.map(r => `<li><a href="${esc(r.href)}">${esc(r.label)}</a> <small class="meta">${esc(r.facetLabel ?? '')}${r.why === 'similar' ? ' · similar' : ''}</small></li>`).join('')}</ul></div>`
}

function weightsTable (weights, session) {
  const rows = FEATURES.map(k => `<tr><th scope="row">${LABELS[k]}</th><td>${weights[k].toFixed(2)}</td><td class="meta">${DEFAULT_WEIGHTS[k]}</td></tr>`).join('')
  const reset = session?.user ? `<form method="post" action="/farelo/next/weights/reset">${formFields(session, '/farelo/next')}<button class="secondary">Reset to defaults</button></form>` : ''
  return `<details class="weights"><summary>How suggestions are scored</summary>
<p class="meta">Each reason adds (or takes away) its weight × how strongly it applies. Choosing a suggestion lower in the list nudges the weights toward what made it your choice; “Not now” pushes that task down for a few days.</p>
<table><thead><tr><th scope="col">Reason</th><th scope="col">Weight</th><th scope="col">Default</th></tr></thead><tbody>${rows}</tbody></table>
${reset}
</details>`
}

export function renderNext ({ ranked, closeCall, weights, contexts, total, related, query, explanation = null, tabs, session }) {
  const shown = ranked.map(r => r.task.id)
  const items = ranked.map((item, i) => `<li class="suggestion${i === 0 ? ' top' : ''}">
<div class="suggestion-head"><span class="rank">${i + 1}</span><h2><a href="${taskPath(item.task)}">${titleHtml(item.task)}</a></h2><span class="score" title="score">${item.score.toFixed(1)}</span></div>
<p class="meta">${metaLine(item.task, { projects: false })}</p>
${reasonList(item.reasons)}
${i === 0 ? relatedList(related) : ''}
${feedback({ item, position: i, shown, query, session })}
</li>`).join('\n')
  const ask = session?.user && ranked.length
    ? `<form method="post" action="/farelo/next/explain">${formFields(session, '')}<input type="hidden" name="minutes" value="${esc(query.minutes ?? '')}"><input type="hidden" name="context" value="${esc(query.context ?? '')}"><button class="secondary">Ask an LLM to talk it through</button></form>`
    : ''
  const said = explanation
    ? `<section class="explanation" aria-labelledby="llm-h"><h2 id="llm-h">A second opinion</h2>${explanation.ok ? `<p>${esc(explanation.text).replace(/\n+/g, '</p><p>')}</p><p class="meta">${esc(explanation.by)} — advisory only; the order above is DIM’s.</p>` : `<p class="muted">${esc(explanation.error)}</p>`}</section>`
    : ''
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/farelo/">Tasks</a></nav>
<h1>What next?</h1>
${contextForm({ ...query, contexts })}
${closeCall ? '<p class="close-call">It’s a close call at the top — <a href="/farelo/dice">roll the dice</a> if you can’t choose.</p>' : ''}
${ranked.length ? `<ol class="suggestions">${items}</ol>` : '<p class="muted">Nothing is ready: move tasks to To do (or finish what they wait on).</p>'}
<p class="meta">${total} task${total === 1 ? '' : 's'} ready · showing the top ${ranked.length}</p>
${said}
${ask}
${weightsTable(weights, session)}`
  return page({ title: 'What next?', body, tabs, session, head: '<link rel="stylesheet" href="/static/css/advisor.css">' })
}

/** A small card for other pages (Squirt): the top suggestion. */
export function nextCard (item) {
  if (!item) return ''
  const top = item.reasons.slice(0, 2).map(r => r.text).join(' · ')
  return `<section class="next-card" aria-labelledby="next-h"><h2 id="next-h">Next up</h2>
<p><a href="${taskPath(item.task)}">${titleHtml(item.task)}</a></p>
${top ? `<p class="meta">${esc(top)}</p>` : ''}
<p><a href="/farelo/next">Why, and what else →</a></p>
</section>`
}
