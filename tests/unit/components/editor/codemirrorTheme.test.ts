import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createEditorTheme } from '../../../../src/renderer/components/editor/codemirrorTheme'

// createEditorTheme reads CSS custom properties off :root at call time and
// bakes them into an EditorView.theme extension. We set the variables, mount a
// real EditorView with the extension, and assert the computed style classes.

const VARS: Record<string, string> = {
  '--color-bg': 'rgb(26, 27, 38)',
  '--color-bg-secondary': 'rgb(22, 22, 30)',
  '--color-text': 'rgb(192, 202, 245)',
  '--color-text-muted': 'rgb(86, 95, 137)',
  '--color-accent': '#7aa2f7',
  '--color-border': 'rgb(41, 46, 66)',
}

function setVars(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    document.documentElement.style.setProperty(k, v)
  }
}

function clearVars() {
  for (const k of Object.keys(VARS)) {
    document.documentElement.style.removeProperty(k)
  }
}

function mountView(): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  return new EditorView({
    state: EditorState.create({ doc: 'hello', extensions: [createEditorTheme()] }),
    parent,
  })
}

describe('createEditorTheme', () => {
  let view: EditorView | null = null

  beforeEach(() => setVars(VARS))

  afterEach(() => {
    view?.destroy()
    view = null
    clearVars()
    document.body.innerHTML = ''
  })

  it('returns a CodeMirror extension usable in an EditorState', () => {
    const ext = createEditorTheme()
    expect(ext).toBeTruthy()
    const state = EditorState.create({ doc: '', extensions: [ext] })
    expect(state).toBeTruthy()
  })

  it('marks the theme as dark via the darkTheme facet', () => {
    view = mountView()
    expect(view.state.facet(EditorView.darkTheme)).toBe(true)
  })

  it('applies the --color-bg variable as the editor background', () => {
    view = mountView()
    const style = getComputedStyle(view.dom)
    expect(style.backgroundColor).toBe(VARS['--color-bg'])
  })

  it('applies the --color-text variable as the editor text color', () => {
    view = mountView()
    const style = getComputedStyle(view.dom)
    expect(style.color).toBe(VARS['--color-text'])
  })

  it('sets the 13px base font size', () => {
    view = mountView()
    expect(getComputedStyle(view.dom).fontSize).toBe('13px')
  })

  it('sets height 100% on the editor root', () => {
    view = mountView()
    expect(getComputedStyle(view.dom).height).toBe('100%')
  })

  it('uses a monospace font stack on the content element', () => {
    view = mountView()
    const content = view.dom.querySelector('.cm-content') as HTMLElement
    expect(content).toBeTruthy()
    expect(getComputedStyle(content).fontFamily).toContain('ui-monospace')
    expect(getComputedStyle(content).fontFamily).toContain('monospace')
  })

  it('snapshots the CSS variables at creation time, not render time', () => {
    // Create the extension under one palette...
    const ext = createEditorTheme()
    // ...then change the palette before mounting.
    setVars({ ...VARS, '--color-bg': 'rgb(255, 0, 0)' })
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    view = new EditorView({
      state: EditorState.create({ doc: '', extensions: [ext] }),
      parent,
    })
    // The original bg (captured at createEditorTheme() time) wins.
    expect(getComputedStyle(view.dom).backgroundColor).toBe(VARS['--color-bg'])
  })

  it('reflects updated CSS variables when called again', () => {
    setVars({ ...VARS, '--color-bg': 'rgb(1, 2, 3)' })
    view = mountView()
    expect(getComputedStyle(view.dom).backgroundColor).toBe('rgb(1, 2, 3)')
  })

  it('produces empty-string colors (not a crash) when variables are missing', () => {
    clearVars()
    expect(() => createEditorTheme()).not.toThrow()
  })

  it('two invocations build independent extensions', () => {
    const a = createEditorTheme()
    const b = createEditorTheme()
    expect(a).not.toBe(b)
  })
})
