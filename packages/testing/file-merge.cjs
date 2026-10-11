#!/usr/bin/env node
/**
 * file-merge.cjs — the file-change rows of one file read as one row (D62, D45).
 *
 * Registered in the lane's scenario table (packages/testing/scenarios.cjs).
 *
 * The `fileEdits` script (packages/testing/mock-llm.cjs) changes one file four
 * times from inside one program and writes a second file once. The host renders
 * one row per call, and a program's calls stand side by side under the
 * program's own row, so the four rows of the first file are on the page
 * together; the program waits between its changes, so the number can be watched
 * growing. They have to stand as one: the earliest of them stays visible with
 * the total of the four changes in its tail, rolling as each change lands, and
 * the other three leave the page whole. The second file's single row stays its
 * own. The row that stands opens onto every change of the file.
 *
 * The calls have to be dispatched from a program: the host's `run_code` is the
 * only model-facing tool of the `ptc` agent preset, which this scenario selects
 * in the lane's patch layer — a direct call would leave one row at a time on the
 * page, and there would be nothing to read together.
 */
'use strict'
const fs = require('node:fs')
const path = require('node:path')

/** What the four scripted edits replace: the file the scenario writes before the turn. */
const APP = 'const first = 1\nconst second = 1\nconst third = 1\nconst fourth = 1\n'
/** How many changes the script makes to that file, and how many lines each one adds and removes. */
const CHANGES = 4
/** The text each change leaves behind, so the merged card can be read for all of them. */
const NEW_LINES = ['const first = 2', 'const second = 2', 'const third = 2', 'const fourth = 2']

/**
 * Every file-change row on the page: which one stands for its file, its path,
 * its tail, whether it is visible, and the box the host drew for that call. A
 * figure rolls one character at a time, so its number is the digits in flow of
 * its own two characters read in order.
 */
const readRows = (page) => page.evaluate(() => {
  const figuresOf = (root) => ['.dsh-claude-file-add', '.dsh-claude-file-del'].map((selector) => {
    const figure = root.querySelector(selector)
    if (figure === null) return null
    return [...figure.querySelectorAll('.dsh-claude-file-roll-in')].map((span) => span.textContent).join('')
  })
  return [...document.querySelectorAll('.dsh-claude-file-root')].map((root) => {
    const box = root.closest('[data-chat-call-id]')
    const figures = figuresOf(root)
    return {
      merge: root.getAttribute('data-dsh-claude-file-merge'),
      path: root.querySelector('.dsh-claude-file-link, .dsh-claude-file-summary')?.textContent ?? null,
      add: figures[0] ?? null,
      del: figures[1] ?? null,
      visible: root.checkVisibility(),
      carrierDisplay: box === null ? null : getComputedStyle(box).display,
      carrierHeight: box === null ? null : Math.round(box.getBoundingClientRect().height),
    }
  })
})

/**
 * The row that stands for the changed file, sampled once: its figures, whether a
 * digit is leaving and a digit rising, and how many rows of that file the reader
 * can see.
 */
const readHead = (page, file) => page.evaluate((suffix) => {
  const figuresOf = (root) => ['.dsh-claude-file-add', '.dsh-claude-file-del'].map((selector) => {
    const figure = root.querySelector(selector)
    if (figure === null) return null
    return [...figure.querySelectorAll('.dsh-claude-file-roll-in')].map((span) => span.textContent).join('')
  })
  const roots = [...document.querySelectorAll('.dsh-claude-file-root')]
  const ofFile = (root) => (root.querySelector('.dsh-claude-file-link, .dsh-claude-file-summary')?.textContent ?? '').endsWith(suffix)
  const mark = (root) => root.getAttribute('data-dsh-claude-file-merge')
  // The row that stands, or the file's one row before a second change joins it.
  const head = roots.find((root) => mark(root) === 'head') ?? roots.find((root) => ofFile(root) && mark(root) === null)
  if (head === undefined) return null
  const figures = figuresOf(head)
  // A character is rolling while the digit leaving it and the digit rising into
  // it both have an animation in flight.
  const running = (selector) => [...head.querySelectorAll(selector)]
    .some((span) => span.getAnimations().some((animation) => animation.playState === 'running'))
  return {
    add: figures[0] ?? null,
    del: figures[1] ?? null,
    leaving: running('.dsh-claude-file-roll-out'),
    rising: running('.dsh-claude-file-roll-in'),
    visible: roots.filter((root) => ofFile(root) && root.checkVisibility()).length,
  }
}, file)

/** One number out of a `+n` figure. */
const count = (figure) => Number(String(figure ?? '').replace(/[^\d]/g, ''))

function fileMergeScenario({ check }) {
  return {
    script: 'fileEdits',
    prompt: 'change the file a few times',
    delayMs: 250,
    // The program-dispatched calls the rows are read together in: the `ptc`
    // preset is the one whose model-facing tool is `run_code`.
    patch: [
      '- id: agent-preset-registry',
      '  config:',
      '    default: ptc',
    ],
    /** The workspace the scratch host opens its session in, with the file the scripted edits chain onto. */
    async beforeSend(context) {
      const workspace = path.join(context.home, 'workspace')
      fs.mkdirSync(workspace, { recursive: true })
      fs.writeFileSync(path.join(workspace, 'app.js'), APP)
      fs.rmSync(path.join(workspace, 'notes.md'), { force: true })
    },
    /** Follow the row that stands while the changes land, and what the reader can see of that file's rows. */
    async duringTurn(context) {
      const { page } = context
      const samples = []
      const deadline = Date.now() + 60000
      while (Date.now() < deadline) {
        const sample = await readHead(page, 'app.js')
        if (sample !== null) samples.push(sample)
        if (await page.evaluate(() => document.querySelector('[data-chat-running]') === null)) break
        await page.waitForTimeout(100)
      }
      context.notes.samples = samples
    },
    async afterTurn(context) {
      const { page } = context
      // A finished turn folds its process under the host's own control, and that
      // control's own shell keeps the group header out of sight until it opens:
      // the turn's control first, then the group's header, puts the rows up.
      const turn = page.locator('button[data-turn-process]')
      if (await turn.isEnabled()) await turn.click()
      await page.waitForTimeout(400)
      const header = page.locator('button[data-process-activity]').first()
      if (await header.count() > 0) await header.click()
      await page.waitForTimeout(500)
      context.notes.rows = await readRows(page)
      // Opening the row that stands has to read every change of the file: the
      // card caps its lines, so its own fold control is pressed first.
      const head = page.locator('.dsh-claude-file-root[data-dsh-claude-file-merge="head"]').first()
      await head.locator('.dsh-claude-file-title').click()
      await page.waitForTimeout(300)
      const fold = head.locator('[data-diff] button[aria-expanded="false"]')
      if (await fold.count() > 0) await fold.first().click()
      await page.waitForTimeout(300)
      context.notes.card = await head.evaluate((root) => root.querySelector('.dsh-claude-file-diff')?.textContent ?? null)
    },
    async assert({ session, notes }) {
      const rows = notes.rows ?? []
      const samples = notes.samples ?? []
      const app = rows.filter((row) => (row.path ?? '').endsWith('app.js'))
      const notesRows = rows.filter((row) => (row.path ?? '').endsWith('notes.md'))
      const head = app.find((row) => row.merge === 'head') ?? {}
      const members = app.filter((row) => row.merge === 'member')
      const adds = samples.map((sample) => count(sample.add))
      const shown = samples.map((sample) => sample.visible)
      const changes = adds.filter((add, at) => at > 0 && add !== adds[at - 1]).length
      const leaving = samples.filter((sample) => sample.leaving).length
      const rising = samples.filter((sample) => sample.rising).length
      const card = notes.card ?? ''
      return [
        check('同一个文件的四次改动在页面上只留一行可见',
          app.length === CHANGES && app.filter((row) => row.visible).length === 1,
          JSON.stringify(app)),
        check('可见的那一行是这一组里最早的一行，带着代表行的标记',
          head.merge === 'head' && head.visible === true, JSON.stringify(head)),
        check('其余三行整行离开页面，不占高度',
          members.length === CHANGES - 1 && members.every((row) => row.carrierDisplay === 'none' && row.carrierHeight === 0),
          JSON.stringify(members)),
        check('代表行的行尾是这些改动的累计值',
          count(head.add) === CHANGES && count(head.del) === CHANGES,
          `head=${head.add} ${head.del}; rows=${JSON.stringify(app.map((row) => `${row.add}${row.del}`))}`),
        check('轮次进行中数字随每次改动长大，这个文件始终不多于一行可见',
          changes >= CHANGES - 1 && adds.length > 0 && adds[adds.length - 1] === CHANGES && shown.every((count) => count <= 1),
          `${changes} changes over ${adds.length} samples: adds=${JSON.stringify(adds)} shown=${JSON.stringify(shown)}`),
        check('数字变化时旧数字向上离开、新数字自下升入',
          leaving >= 1 && rising >= 1,
          `frames leaving=${leaving}, rising=${rising} of ${samples.length}`),
        check('另一个文件只写一次，单独成行，没有被卷进这一次合并',
          notesRows.length === 1 && notesRows[0].merge === null, JSON.stringify(notesRows)),
        check('展开代表行读到的是全部改动',
          NEW_LINES.every((text) => card.includes(text)), JSON.stringify(card.slice(0, 240))),
        check('控制台没有异常', session.problems.length === 0, session.problems.slice(0, 3).join(' | ')),
      ]
    },
  }
}

module.exports = { fileMergeScenario }
