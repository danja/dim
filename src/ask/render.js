import { esc } from '../common/http/respond.js'
import { renderPage } from '../common/ui/layout.js'
import { formFields } from '../common/http/write.js'

/** Ask pages: the transcript of turns and the question form. */

/** Escape an answer and turn [n] into links to that turn's sources. */
export function answerHtml (text, turn, count) {
  return esc(text).replace(/\[(\d{1,2})\]/g, (whole, n) => Number(n) >= 1 && Number(n) <= count ? `<a class="cite" href="#src-${turn}-${n}">[${n}]</a>` : whole)
}

function sourceItem (item, i, turn) {
  const how = item.seed ? 'search hit' : `${item.hops} hop${item.hops === 1 ? '' : 's'}`
  const via = item.via.map(v => `${v.kind}: ${v.label}`).join('; ')
  return `<li id="src-${turn}-${i + 1}"><a href="${esc(item.href)}">${esc(item.label)}</a>
<span class="meta">${esc(item.facetLabel)} · ${item.score} · ${how}${via ? ` · via ${esc(via)}` : ''}</span>
<p class="snippet">${esc(item.text.replace(/\s+/g, ' ').slice(0, 280))}</p></li>`
}

/** One question and what came back. turn: { n, question, retrieval, answer: { text }|{ error }|null, changes, unknown } */
export function renderTurn ({ n, question, retrieval, answer, by = null, changes = [], unknown = [] }) {
  const items = retrieval.items
  const clusters = retrieval.communities ?? []
  const reply = !answer
    ? '<p class="meta">Retrieval only: no answer was asked for.</p>'
    : answer.error
      ? `<p class="problem" role="alert">${esc(answer.error)}</p>`
      : `<p class="answer">${answerHtml(answer.text, n, items.length)}</p>`
  return `<article class="turn" id="turn-${n}">
<p class="q"><span class="who">You</span>${esc(question)}</p>
<div class="a"><span class="who">DIM${by ? ` · ${esc(by)}` : ''}</span>${reply}</div>
<details class="ctx"${answer ? '' : ' open'}>
<summary>${items.length} source${items.length === 1 ? '' : 's'}${clusters.length ? `, ${clusters.length} cluster${clusters.length === 1 ? '' : 's'}` : ''}</summary>
${retrieval.semanticError ? `<p class="meta">Words only: ${esc(retrieval.semanticError)}</p>` : ''}
${clusters.map(c => `<p class="cluster"><strong>Cluster</strong> (${c.size} items, ${c.score}): ${esc(c.summary)}</p>`).join('')}
${items.length ? `<ol class="sources">${items.map((item, i) => sourceItem(item, i, n)).join('\n')}</ol>` : '<p class="meta">Nothing found.</p>'}
<p class="meta">${retrieval.edges.length} links between these. Settings: ${changes.length ? esc(changes.join(' ')) : 'defaults'}${unknown.length ? `. Ignored: ${esc(unknown.join(' '))}` : ''}</p>
</details>
</article>`
}

export function renderAsk ({ turns = [], values = {}, tabs, session, ready, where = [] }) {
  const checked = name => values[name] ? ' checked' : ''
  const body = `<h1>Ask</h1>
<p class="meta">Questions answered from what DIM holds, by graph retrieval over search, links and topics${ready ? '' : '. No model is configured (OLLAMA_URL), so you will get the retrieved sources only'}.${where.length ? ` Answers may come from ${esc(where.join(', '))}: the sources shown below are sent there.` : ''}</p>
<section id="chat" class="chat" aria-live="polite" aria-label="Conversation">
${turns.map(renderTurn).join('\n')}
</section>
<form id="ask-form" class="edit ask-form" method="post" action="/ask">${formFields(session, '')}
<input type="hidden" name="turn" value="${turns.length + 1}">
<input type="hidden" name="history" value="">
<label for="ask-q">Question</label>
<textarea id="ask-q" name="q" rows="3" required maxlength="2000" autofocus>${esc(values.q ?? '')}</textarea>
<details class="ask-settings"><summary>Settings</summary>
<label class="check"><input type="checkbox" name="similar" value="1"${checked('similar')}> Follow similar items (embedding neighbours)</label>
<label class="check"><input type="checkbox" name="communities" value="1"${checked('communities')}> Use cluster summaries</label>
<label class="check"><input type="checkbox" name="contextOnly" value="1"${checked('contextOnly')}> Retrieval only (no answer)</label>
<label for="ask-tune">Other options</label>
<input type="text" id="ask-tune" name="tune" value="${esc(values.tune ?? '')}" placeholder="hops=1 fanout=6 wRelated=1" autocomplete="off" spellcheck="false">
<p class="meta">Names and defaults: docs/rag.md</p>
</details>
<button>Ask</button>
</form>`
  return renderPage({
    title: 'Ask',
    tabs,
    active: 'ask',
    session,
    body,
    head: '<link rel="stylesheet" href="/static/css/ask.css">\n<script type="module" src="/static/js/ask.js"></script>'
  })
}
