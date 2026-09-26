import { describe, it, expect } from 'vitest'
import { rank, learn, isCloseCall, DEFAULT_WEIGHTS, FEATURES } from '../../src/advisor/score.js'
import { Advisor, cleanContext, topicWords } from '../../src/advisor/Advisor.js'
import { llmConfig, explain, explainPrompt } from '../../src/advisor/explain.js'
import { NOW, fixtureTasks, memoryAdvisorStores } from './fixture.js'

const ids = ranked => ranked.map(r => r.task.id)
const T = 'http://purl.org/stuff/dim/task/'

describe('scoring', () => {
  it('ranks only ready tasks, deterministically, with reasons', () => {
    const a = rank(fixtureTasks(), { now: NOW, resources: new Map([[T + 'tax', 2]]) })
    const b = rank(fixtureTasks(), { now: NOW, resources: new Map([[T + 'tax', 2]]) })
    expect(ids(a)).toEqual(ids(b))
    expect(ids(a)).toEqual(['tax', 'vco', 'old', 'glue'])
    const tax = a[0]
    expect(tax.reasons.map(r => r.text)).toEqual(['priority 1', 'due in 2 days', '2 linked resources'])
    expect(tax.reasons.map(r => r.points)).toEqual([3, 2.571, 0.5])
    expect(tax.score).toBe(6.124) // + age 0.053
    expect(a.find(r => r.task.id === 'vco').reasons.map(r => r.text)).toContain('2 tasks wait on it')
    expect(a.find(r => r.task.id === 'old').reasons.map(r => r.text)).toContain('waiting 117 days')
  })

  it('takes time and context into account', () => {
    const any = rank(fixtureTasks(), { now: NOW })
    const short = rank(fixtureTasks(), { now: NOW, minutes: 15 })
    expect(ids(short).indexOf('glue')).toBeLessThan(ids(any).indexOf('glue'))
    expect(short.find(r => r.task.id === 'tax').score).toBeLessThan(any.find(r => r.task.id === 'tax').score)
    expect(short.find(r => r.task.id === 'tax').reasons.map(r => r.text)).toContain('needs ~90 min, more than 15')
    const town = rank(fixtureTasks(), { now: NOW, minutes: 15, context: '@town' })
    expect(ids(town).indexOf('glue')).toBeLessThan(ids(short).indexOf('glue'))
    expect(town.find(r => r.task.id === 'vco').reasons.map(r => r.text)).toContain('for @bench, not @town')
  })

  it('pushes a skipped task down, fading over days', () => {
    const before = rank(fixtureTasks(), { now: NOW })
    const skips = new Map([[T + 'tax', [NOW.toISOString()]]])
    const after = rank(fixtureTasks(), { now: NOW, skips })
    expect(ids(before)[0]).toBe('tax')
    expect(ids(after)[0]).toBe('vco')
    expect(after.find(r => r.task.id === 'tax').values.skipped).toBe(-1)
    const later = rank(fixtureTasks(), { now: new Date(NOW.getTime() + 20 * 86400000), skips })
    expect(later.find(r => r.task.id === 'tax').values.skipped).toBe(0)
  })

  it('learns toward a chosen lower suggestion, within bounds', () => {
    const ranked = rank(fixtureTasks(), { now: NOW })
    const glue = ranked.find(r => r.task.id === 'glue')
    const next = learn(DEFAULT_WEIGHTS, glue, ranked.slice(0, ranked.indexOf(glue)))
    expect(next.priority).toBeLessThan(DEFAULT_WEIGHTS.priority)
    for (const k of FEATURES) expect(next[k]).toBeGreaterThanOrEqual(0.1)
    const again = rank(fixtureTasks(), { now: NOW, weights: next })
    expect(ids(again).indexOf('glue')).toBeLessThanOrEqual(ids(ranked).indexOf('glue'))
    expect(isCloseCall([{ score: 5 }, { score: 4.9 }])).toBe(true)
    expect(isCloseCall([{ score: 5 }, { score: 4 }])).toBe(false)
  })
})

describe('Advisor', () => {
  it('suggests, and a skip changes later ordering', async () => {
    const { taskStore, advice } = memoryAdvisorStores()
    const advisor = new Advisor({ tasks: taskStore, advice, now: () => NOW })
    const first = await advisor.suggest()
    expect(ids(first.ranked)).toEqual(['tax', 'vco', 'old', 'glue'])
    expect(first.contexts).toEqual(['@bench', '@desk', '@town'])
    await advisor.skip('tax', { rank: 1, actor: 'owner' })
    const second = await advisor.suggest()
    expect(ids(second.ranked)[0]).toBe('vco')
    expect(second.ranked.find(r => r.task.id === 'tax').reasons.map(r => r.text)).toContain('skipped 1× lately')
  })

  it('accepting learns from what was above and moves the task to Doing', async () => {
    const { taskStore, advice, moved, getWeights } = memoryAdvisorStores()
    const advisor = new Advisor({ tasks: taskStore, advice, now: () => NOW })
    await advisor.accept('glue', { shown: ['tax', 'vco', 'old', 'glue'], actor: 'owner' })
    expect(moved).toEqual([['glue', 'doing']])
    expect(advice.records.at(-1)).toMatchObject({ task: T + 'glue', action: 'accept', rank: 4 })
    expect(getWeights().priority).toBeLessThan(DEFAULT_WEIGHTS.priority)
    await expect(advisor.accept('nope', { actor: 'owner' })).rejects.toMatchObject({ status: 404 })
  })

  it('finds related things by topic words only', async () => {
    expect(topicWords('Write the Farelo docs!')).toEqual(['farelo', 'docs'])
    const { taskStore, advice } = memoryAdvisorStores()
    const advisor = new Advisor({ tasks: taskStore, advice, now: () => NOW })
    advisor.registry = {
      async lookup () { return null },
      async find (q) {
        return [{ facet: 'gnamgnam', label: 'GnamGnam', results: [{ iri: 'b1', label: 'Tax returns guide', href: '/b1' }, { iri: 'b2', label: 'How to write well', href: '/b2' }, { iri: 'b3', label: 'Taxonomy returning', href: '/b3' }] }]
      }
    }
    expect((await advisor.related({ iri: 't', title: 'File the tax return' })).map(r => r.iri)).toEqual(['b1'])
  })

  it('cleans the context it is given', () => {
    expect(cleanContext({ minutes: '30', context: '@Home' })).toEqual({ minutes: 30, context: '@home' })
    expect(cleanContext({ minutes: '31', context: 'home; drop' })).toEqual({ minutes: null, context: null })
  })
})

describe('LLM second opinion', () => {
  it('picks a configured provider and never changes the order', async () => {
    expect(llmConfig({})).toBeNull()
    expect(llmConfig({ LLM_PROVIDERS: 'mistral,groq', GROQ_API_KEY: 'k' })).toMatchObject({ name: 'groq', apiKey: 'k' })
    const ranked = rank(fixtureTasks(), { now: NOW })
    expect(explainPrompt(ranked, { minutes: 30 })).toContain('1. File the tax return')
    const fetchImpl = async (url, init) => new Response(JSON.stringify({ choices: [{ message: { content: 'Start with the tax return.' } }] }))
    expect(await explain(ranked, { config: { name: 'x', baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', maxTokens: 10 }, fetchImpl })).toEqual({ ok: true, text: 'Start with the tax return.', by: 'x/m' })
    expect((await explain(ranked, { config: null })).ok).toBe(false)
  })
})
