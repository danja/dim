/* eslint-env browser */
// Ask: send the question without leaving the page and add the turn to the
// transcript. Without this the form posts and the page shows the one turn.

const form = document.querySelector('#ask-form')
const chat = document.querySelector('#chat')
const field = form?.elements.q
const earlier = [] // [{ q, a }] sent with each new question

if (form && chat) {
  let busy = false

  const send = async () => {
    const question = field.value.trim()
    if (!question || busy) return
    busy = true
    const turn = earlier.length + 1
    form.elements.turn.value = turn
    form.elements.history.value = JSON.stringify(earlier)
    const button = form.querySelector('button')
    button.disabled = true
    const pending = document.createElement('p')
    pending.className = 'pending'
    pending.textContent = 'Thinking…'
    chat.append(pending)
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(new FormData(form))
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
      pending.remove()
      chat.insertAdjacentHTML('beforeend', result.html)
      if (result.answer) earlier.push({ q: question, a: result.answer })
      else earlier.push({ q: question, a: '' })
      field.value = ''
      chat.lastElementChild.scrollIntoView({ block: 'start' })
    } catch (error) {
      pending.className = 'problem'
      pending.textContent = `Failed: ${error.message}`
    } finally {
      busy = false
      button.disabled = false
      field.focus()
    }
  }

  form.addEventListener('submit', e => {
    e.preventDefault()
    send()
  })
  // Enter sends, Shift+Enter adds a line.
  field.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      form.requestSubmit()
    }
  })
}
