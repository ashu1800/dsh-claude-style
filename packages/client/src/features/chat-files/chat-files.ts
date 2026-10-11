import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as React from 'react'
import { CHAT_DIFF_MAX_LINES, CHAT_FILE_ADD_CLASS, CHAT_FILE_BODY_CLASS, CHAT_FILE_CHEVRON_CLASS, CHAT_FILE_DEL_CLASS, CHAT_FILE_DIFF_CLASS, CHAT_FILE_HIDDEN_CLASS, CHAT_FILE_INSPECT_CLASS, CHAT_FILE_IO_CLASS, CHAT_FILE_IO_DIVIDER_CLASS, CHAT_FILE_IO_LABEL_CLASS, CHAT_FILE_IO_SECTION_CLASS, CHAT_FILE_IO_TEXT_CLASS, CHAT_FILE_LEADING_CLASS, CHAT_FILE_LINK_CLASS, CHAT_FILE_MERGED_COPY, CHAT_FILE_MERGE_ATTR, CHAT_FILE_MERGE_GONE, CHAT_FILE_MERGE_HEAD, CHAT_FILE_MERGE_MEMBER, CHAT_FILE_ROLLING_CLASS, CHAT_FILE_ROLL_CLASS, CHAT_FILE_ROLL_IN_CLASS, CHAT_FILE_ROLL_OUT_CLASS, CHAT_FILE_ROW_CLASS, CHAT_FILE_ROW_LINE_CLASS, CHAT_FILE_SEAT, CHAT_FILE_SEP_CLASS, CHAT_FILE_STAT_CLASS, CHAT_FILE_SUFFIX_CLASS, CHAT_FILE_TITLE_CLASS, chatFileCallHead, chatFileDiffBlockLabels, chatFileDiffHunks, chatFileParseArgs, chatFileRowModel, chatFileStateLabel, chatFileSummaryClassName } from './file-row-model'
import { createFileMerge, rowCarrier } from './file-row-merge'
import { copyLabel } from '../../core/i18n'
import { motionReduced } from '../../core/prefs'
import { createStamp } from '../../shared/dom'
import type { FileRowState } from './file-row-model'
import type { HostContext, HostFiber, HostText } from '../../core/host'
import type { HostChatBlock } from '@dsh-claude-style/contracts/services'
import type { FeatureUi } from '../../core/feature'
import type manifest from './chat-files.manifest'

/** The seat's owner payload for a file tool row, plus the seat's copy. */
interface ChatFileRowProps {
  t: HostText
  toolName: string
  block: HostChatBlock
  cwd?: string
  home?: string
  openFile: (path: string) => void
  inspect?: () => void
  useDisclosure: () => { expanded: boolean, toggle: () => void }
}

/**
 * The file-change row: a write or edit call rendered as the host's own file
 * row, with the diff card the host draws for root calls only.
 *
 * The row takes the seat's owner payload and the seat's own `t` seat, and
 * renders collapsed as the title, the path and the `+n -m` tail, expanded as
 * the diff card. The host's own rows are the two keyed seats at the default
 * priority 0, and a keyed seat renders the lowest priority, so both are taken
 * over at priority -1; a second registration at one priority throws, so the
 * two keys are claimed together.
 *
 * The host's ToolRow component and its CSS Modules names are not part of the
 * frozen primitives table, so the chrome is redrawn here from the primitives
 * that are shared (DisclosureRow, TextShimmer, DiffBlock, diffTotals); the
 * row's own sizes and rhythm are in chat-files.css.
 *
 * The rows of one file inside one process group stand as one (file-row-merge.ts,
 * D62): the earliest of them draws the file's whole tail and whole diff card,
 * and the others take their boxes off the page. A file touched once is drawn
 * exactly as it was before merging existed.
 *
 * dsh-chat-ux claims the same two keys on the same seat at the same priority,
 * and a second registration at one priority throws, so the entry keeps this
 * feature uninstalled while that plugin is on the page and installs it when
 * the plugin goes (the manifest).
 *
 * @param ctx - client context.
 * @param ui - shared handle table.
 * @returns teardown.
 */
export function install(ctx: HostContext, ui: FeatureUi<typeof manifest>) {
  const h = React.createElement

  /** The rows of one file read together; one install owns one registry (D62). */
  const fileMerge = createFileMerge()

  /**
   * One figure of the row's tail. A change rolls the number it showed upward as
   * the new one rises in behind it — the same 160 ms and curve the process
   * header's figures roll with (dsh-better-display's fold figures,
   * THIRD_PARTY_NOTICES.md) — and the animation choice decides whether the
   * leaving number is drawn at all (D26).
   */
  const RollingStat = (props: { className: string, text: string, running: boolean }) => {
    const [leaving, setLeaving] = React.useState<string | null>(null)
    const shown = React.useRef(props.text)
    React.useLayoutEffect(() => {
      const before = shown.current
      if (before === props.text) return
      shown.current = props.text
      setLeaving(motionReduced() ? null : before)
    }, [props.text])
    // The number in flow is keyed by its own text, so a change mounts a fresh
    // element, and the travel is classed on the figure rather than on that
    // element: an animation starts when its name reaches an element that did
    // not carry it, which is what makes the rising number rise on every change
    // while the row's first number stands still where it appeared.
    const rolling = leaving !== null
    return h(primitives.TextShimmer, {
      className: props.className + ' ' + CHAT_FILE_ROLL_CLASS + (rolling ? ' ' + CHAT_FILE_ROLLING_CLASS : ''),
      active: props.running,
      children: [
        leaving === null ? null : h('span', {
          key: 'out',
          className: CHAT_FILE_ROLL_OUT_CLASS,
          'aria-hidden': true,
          onAnimationEnd: () => setLeaving(null),
        }, leaving),
        h('span', { key: props.text, className: CHAT_FILE_ROLL_IN_CLASS }, props.text),
      ],
    })
  }

  /**
   * One row's render.
   * @param props - the owner payload and the seat's copy seat.
   * @returns this row.
   */
  const ChatFileRow = (props: ChatFileRowProps) => {
    const { t, toolName, block, cwd, home, openFile, inspect, useDisclosure } = props
    const { expanded, toggle } = useDisclosure()
    const rootRef = React.useRef<HTMLDivElement | null>(null)
    const args = React.useMemo(() => {
      const head = chatFileCallHead(block)
      return head === null ? null : chatFileParseArgs(head.argsRaw)
    }, [block])
    const model = React.useMemo(() => chatFileRowModel(toolName, block, args, cwd, home), [args, block, cwd, home, toolName])
    const hunks = React.useMemo(() => chatFileDiffHunks(block, args), [args, block])
    const labels = React.useMemo(() => chatFileDiffBlockLabels(t), [t])
    // The view this row's file asks for (D62): null while it is not registered,
    // and a group of one call draws exactly what it drew before merging existed.
    const merge = React.useSyncExternalStore(fileMerge.subscribe, () => fileMerge.viewFor(rootRef.current))
    const merged = merge !== null && merge.count > 1
    // Only the row that stands draws the whole file; a row it stands for keeps
    // its own tail and card, which the reader never sees.
    const shownHunks = merged && merge.head ? merge.hunks : hunks
    const state: FileRowState = merged && merge.running ? 'running' : model.state
    const running = state === 'running'
    const totals = React.useMemo(() => (shownHunks === null ? null : primitives.diffTotals(shownHunks)), [shownHunks])
    const expandable = shownHunks !== null || model.output !== null || model.bodyRaw !== null
    const open = expanded && expandable
    const summaryText = model.errorSummary ?? model.summary
    const status = chatFileStateLabel(state, t)
    // A failed or interrupted row carries no path link: in those two states
    // the summary holds a verdict or a failure, and a link would read it as a
    // normal change.
    const linkAvailable = model.filePath !== undefined && state !== 'error' && state !== 'stopped'

    // What this row tells the registry about its own call. A call with no path,
    // no change, or a verdict that failed or was interrupted stands alone.
    const own = React.useMemo(() => hunks === null || model.filePath === undefined || (model.state !== 'ok' && model.state !== 'running')
      ? null
      : { path: model.filePath, hunks, state: model.state },
      [hunks, model.filePath, model.state])
    React.useLayoutEffect(() => {
      const element = rootRef.current
      if (element === null || own === null) return
      return fileMerge.put({ element, ...own })
    }, [own])

    // A row the head stands for takes its box off the page: the carrier is the
    // host's call row, so the host row's own spacing goes with it.
    const hidden = merged && !merge.head
    const carrier = React.useMemo(() => createStamp(CHAT_FILE_MERGE_ATTR), [])
    React.useLayoutEffect(() => {
      const element = rootRef.current
      carrier.mark(element === null || !hidden ? null : rowCarrier(element), CHAT_FILE_MERGE_GONE)
      return () => carrier.release()
    }, [carrier, hidden])

    const openFileClick = React.useCallback((event: React.MouseEvent) => {
      event.stopPropagation()
      if (model.filePath === undefined) return
      openFile(model.filePath)
    }, [model.filePath, openFile])
    // The path link is a button inside the row, and the whole row is also the
    // open and close target: Enter and space have to land on this button
    // without bubbling into the row's keydown.
    const linkKeyDown = React.useCallback((event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
    }, [])

    const collapsedContent = summaryText === '' ? null : [
      h('span', { key: 'sep', className: CHAT_FILE_SEP_CLASS, 'aria-hidden': true }),
      linkAvailable
        ? h('button', { key: 'path', type: 'button', className: CHAT_FILE_LINK_CLASS, onClick: openFileClick, onKeyDown: linkKeyDown },
            h(primitives.TextShimmer, { active: running, children: summaryText }))
        : h('span', { key: 'path', className: chatFileSummaryClassName(state) },
            h(primitives.TextShimmer, { active: running, children: summaryText })),
      totals === null ? null : h('span', { key: 'totals', className: CHAT_FILE_SUFFIX_CLASS },
        h(RollingStat, { key: 'add', className: CHAT_FILE_STAT_CLASS + ' ' + CHAT_FILE_ADD_CLASS, text: '+' + totals.added, running }),
        h(RollingStat, { key: 'del', className: CHAT_FILE_STAT_CLASS + ' ' + CHAT_FILE_DEL_CLASS, text: '-' + totals.removed, running })),
    ]

    const inputSection = model.bodyRaw === null ? null : h('div', { className: CHAT_FILE_IO_SECTION_CLASS },
      h('span', { className: CHAT_FILE_IO_LABEL_CLASS }, t('row.input')),
      h('span', { className: CHAT_FILE_IO_TEXT_CLASS }, model.bodyRaw))
    const outputSection = model.output === null ? null : h('div', { className: CHAT_FILE_IO_SECTION_CLASS },
      h('span', { className: CHAT_FILE_IO_LABEL_CLASS }, t('row.output')),
      h('span', { className: CHAT_FILE_IO_TEXT_CLASS, 'data-error': state === 'error' || undefined }, model.output))
    const expandedContent = open ? h('div', { className: CHAT_FILE_BODY_CLASS },
      shownHunks !== null
        ? h(primitives.DiffBlock, { diffs: shownHunks, labels, maxLines: CHAT_DIFF_MAX_LINES, className: CHAT_FILE_DIFF_CLASS })
        : h('div', { className: CHAT_FILE_IO_CLASS },
            inputSection,
            model.bodyRaw !== null && model.output !== null ? h('span', { className: CHAT_FILE_IO_DIVIDER_CLASS, 'aria-hidden': true }) : null,
            outputSection),
      inspect === undefined ? null : h('button', { type: 'button', className: CHAT_FILE_INSPECT_CLASS, onClick: inspect },
        h(primitives.IconInspectOutlineRegular, null),
        t('row.inspect'))) : undefined

    return h('div', {
      ref: rootRef,
      className: CHAT_FILE_ROW_CLASS,
      'data-variant': model.variant,
      'data-tool': toolName,
      'data-state': state,
      [CHAT_FILE_MERGE_ATTR]: merged ? (merge.head ? CHAT_FILE_MERGE_HEAD : CHAT_FILE_MERGE_MEMBER) : undefined,
    },
      status !== null ? h('span', { className: CHAT_FILE_HIDDEN_CLASS }, status) : null,
      // The rows this one stands for leave the page whole, so their calls are
      // said here: a reader who cannot see four rows is told there were four.
      merged ? h('span', { className: CHAT_FILE_HIDDEN_CLASS },
        copyLabel(CHAT_FILE_MERGED_COPY, '{count} changes to the same file are merged into this row', { count: merge.count })) : null,
      h(primitives.DisclosureRow, {
        rowClassName: CHAT_FILE_ROW_LINE_CLASS,
        leadingClassName: CHAT_FILE_LEADING_CLASS,
        titleClassName: CHAT_FILE_TITLE_CLASS,
        chevronClassName: CHAT_FILE_CHEVRON_CLASS,
        icon: h(primitives.IconEditOutlineRegular, { size: 14 }),
        title: t(model.titleKey),
        running,
        open,
        expandable,
        expandOnRowClick: true,
        keepContentWhenOpen: true,
        onToggle: toggle,
        collapsedContent,
      }, expandedContent))
  }

  let slotsFiber: HostFiber | null = null
  if (typeof ctx.inject === 'function') {
    slotsFiber = ctx.inject(['slots'], scope => {
      const slots = scope.get('slots')
      if (slots === undefined || slots === null || typeof slots.inject !== 'function') return
      /** The two keys' registrations, or null while they are not claimed. */
      let seatStops: (() => void) | null = null
      const claimSeats = () => {
        if (seatStops !== null) return
        const seat = { name: CHAT_FILE_SEAT, priority: -1, locale: 'conversation' }
        const stopEdit = slots.register({ ...seat, key: 'edit' }, ChatFileRow)
        const stopWrite = slots.register({ ...seat, key: 'write' }, ChatFileRow)
        let stopped = false
        seatStops = () => {
          if (stopped) return
          stopped = true
          stopEdit()
          stopWrite()
        }
      }
      const releaseSeats = () => {
        if (seatStops === null) return
        seatStops()
        seatStops = null
      }
      scope.effect(() => {
        // The seat is the host's to declare, so the keys wait for it.
        const stopSeat = slots.inject(CHAT_FILE_SEAT, () => {
          claimSeats()
          return releaseSeats
        })
        return () => {
          releaseSeats()
          if (typeof stopSeat === 'function') stopSeat()
        }
      }, 'dsh-claude-style: file change row')
    })
  }
  return () => {
    if (slotsFiber === null) return
    if (typeof slotsFiber.dispose === 'function') slotsFiber.dispose()
    slotsFiber = null
  }
}
