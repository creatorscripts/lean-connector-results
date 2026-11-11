import { expect, test } from 'claude-code/testing'

const record = (id: string) => ({
  id,
  Name: `Deal ${id}`,
  Amount: 0,
  Is_Won: false,
  Phone: null,
  Notes: '',
  Tags: [],
  Owner: { id: '9000000000001', name: 'Alex', email: '' },
  $approval: { delegate: false, approve: false },
  $editable: true,
  _links: { self: 'https://example.test/' + id },
})

const list = (n: number, extra: object = {}) =>
  JSON.stringify({
    data: Array.from({ length: n }, (_, i) => record(String(5000000000000 + i))),
    info: { per_page: 200, more_records: true, next_page_token: 'abc' },
    ...extra,
  })

test('a large list loses empty fields and metadata, keeps paging and falsy values', async ($, on) => {
  const text = list(60)

  on('tool.call', () => ({ result: text, text }))

  const ran = await $.tool.call({ tool: 'mcp__crm__ZohoCRM_getRecords', module: 'Deals' })
  const out = JSON.parse(ran.result as string)

  expect(out.data.length).toBe(60)
  expect(out.data[0]).toEqual({
    id: '5000000000000',
    Name: 'Deal 5000000000000',
    Amount: 0,
    Is_Won: false,
    Owner: { id: '9000000000001', name: 'Alex' },
  })
  expect(out.info.next_page_token).toBe('abc')
  expect(ran.context?.[0]).toMatch(/removed \d+ empty fields/)
})

test('a small result is left alone', async ($, on) => {
  const text = list(2)

  on('tool.call', () => ({ result: text, text }))

  const ran = await $.tool.call({ tool: 'mcp__crm__ZohoCRM_getRecords' })

  expect(ran.result).toBe(text)
})

test('a single record is left alone, however large', async ($, on) => {
  const text = JSON.stringify({ data: [{ ...record('1'), Description: 'x'.repeat(9000) }] })

  on('tool.call', () => ({ result: text, text }))

  const ran = await $.tool.call({ tool: 'mcp__crm__ZohoCRM_getRecord', id: '1' })

  expect(ran.result).toBe(text)
})

test('Deluge code is never touched', async ($, on) => {
  const byContent = list(60, {
    extra: [{ id: 'f1', body: 'resp = zoho.crm.getRecordById("Deals", input.id);\ninfo resp;' }],
  })
  const byKey = list(60, { script: 'x = 1;' })

  const plain = list(60)

  on('tool.call', (_, e) => {
    const text = e.tool.endsWith('B') ? byKey : e.tool.endsWith('A') ? byContent : plain

    return { result: text, text }
  })

  expect((await $.tool.call({ tool: 'mcp__crm__listThingsA' })).result).toBe(byContent)
  expect((await $.tool.call({ tool: 'mcp__crm__listThingsB' })).result).toBe(byKey)
  expect((await $.tool.call({ tool: 'mcp__creator__getFunctions' })).result).toBe(plain)
})

test('Make blueprints are never touched', async ($, on) => {
  const byTool = list(60)
  const byKey = list(60, { blueprint: { flow: [{ id: 1, module: 'http:ActionSendData', mapper: { url: '' } }] } })

  on('tool.call', (_, e) => {
    const text = e.tool === 'mcp__make__make_get_blueprint' ? byTool : byKey

    return { result: text, text }
  })

  expect((await $.tool.call({ tool: 'mcp__make__make_get_blueprint' })).result).toBe(byTool)
  expect((await $.tool.call({ tool: 'mcp__make__list_things' })).result).toBe(byKey)
})

test('a record written in this session comes back whole in later lists', async ($, on) => {
  const text = list(60)

  on('tool.call', (_, e) => (e.tool.includes('update') ? { result: 'ok', text: 'ok' } : { result: text, text }))

  await $.tool.call({ tool: 'mcp__crm__ZohoCRM_updateRecord', recordID: '5000000000003', Name: 'New' })

  const ran = await $.tool.call({ tool: 'mcp__crm__ZohoCRM_getRecords' })
  const out = JSON.parse(ran.result as string)

  expect(out.data[3]).toEqual(record('5000000000003'))
  expect(out.data[4].Phone).toBeUndefined()
  expect(ran.context?.[0]).toMatch(/1 records edited/)
})

test('write tools and text blocks: writes pass, blocks keep their shape', async ($, on) => {
  const text = list(60)

  on('tool.call', (_, e) =>
    e.tool.includes('create')
      ? { result: text, text }
      : { result: [{ type: 'text', text }, { type: 'image', data: '' }], text },
  )

  expect((await $.tool.call({ tool: 'mcp__crm__createRecords' })).result).toBe(text)

  const ran = await $.tool.call({ tool: 'mcp__crm__search_records' })
  const blocks = ran.result as { type: string; text?: string }[]

  expect(blocks.length).toBe(2)
  expect(blocks[1]).toEqual({ type: 'image', data: '' })
  expect(JSON.parse(blocks[0]!.text!).data[0].Phone).toBeUndefined()
})
