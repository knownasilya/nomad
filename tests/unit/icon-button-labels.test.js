import { describe, it, expect } from 'vitest';
import { scanRepo, scanSource, scanMobileSource } from '../../scripts/check-icon-buttons.mjs';

// Every control that shows only an icon has a tooltip: on hover on desktop, on touch and hold on
// the phone (scripts/check-icon-buttons.mjs).
describe('icon-only controls have a tooltip', () => {
  it('holds for every desktop and phone UI file', () => {
    const found = scanRepo().map((r) => `${r.file}:${r.line} ${r.why}\n    ${r.snippet}`);
    expect(found, `Give these a title="…" (see scripts/check-icon-buttons.mjs):\n${found.join('\n')}`).toEqual([]);
  });
});

describe('the scanner', () => {
  const flagged = (src) => scanSource(src).length > 0;

  it('flags a button with only a Font Awesome icon', () => {
    expect(flagged('html`<button @click=${this.go}><span class="fas fa-times"></span></button>`')).toBe(true);
  });

  it('accepts a title, or data-tooltip with aria-label', () => {
    expect(flagged('<button title="Close"><span class="fas fa-times"></span></button>')).toBe(false);
    expect(flagged('<button title=${x ? "A" : "B"}><i class="fa fa-bars"></i></button>')).toBe(false);
    expect(flagged('<button data-tooltip="Close"><i class="fa fa-times"></i></button>')).toBe(true);
    expect(flagged('<button data-tooltip="Close" aria-label="Close"><i class="fa fa-times"></i></button>')).toBe(false);
  });

  it('leaves a button with a text label alone', () => {
    expect(flagged('<button><span class="fas fa-plus"></span> New tab</button>')).toBe(false);
    expect(flagged('<button><span class="fas fa-plus"></span> ${this.label}</button>')).toBe(false);
    expect(flagged('<button>${x ? html`<span class="fa fa-x"></span>` : "Save"}</button>')).toBe(false);
  });

  it('sees icons inside ${…} and in arrow-function handlers', () => {
    expect(
      flagged(
        '<button @click=${(e) => { if (a > b) { go() } }}>${open ? html`<span class="fas fa-angle-up"></span>` : html`<span class="fas fa-angle-down"></span>`}</button>'
      )
    ).toBe(true);
    expect(flagged('<button><i class="fas fa-${open ? \'minus\' : \'plus\'}-square"></i></button>')).toBe(true);
  });

  it('counts glyphs, svgs, images and CSS-drawn buttons as icons', () => {
    expect(flagged('<button @click=${stop}>&times;</button>')).toBe(true);
    expect(flagged('<div class="tab-add-btn" @click=${add}><span class="plus">+</span></div>')).toBe(true);
    expect(flagged('<button><svg viewBox="0 0 1 1"><path d="M0 0"/></svg></button>')).toBe(true);
    expect(flagged('<img src="x.png" @click=${pick} />')).toBe(true);
    expect(flagged('<div class="tab-close" @click=${close}></div>')).toBe(true);
  });

  it('flags a clickable icon, and an <a> with only an icon', () => {
    expect(flagged('<span class="fas fa-times" @click=${close}></span>')).toBe(true);
    expect(flagged('<a href="#"><span class="fas fa-fw fa-times"></span></a>')).toBe(true);
  });

  it('ignores icons that are not controls, and a plain backdrop', () => {
    expect(flagged('<span class="fas fa-lock"></span>')).toBe(false);
    expect(flagged('<div class="overlay" @click=${close}></div>')).toBe(false);
  });

  it('lets a control opt out with a comment', () => {
    expect(flagged('<button><!-- icon-button-ok: labelled by the row --><span class="fas fa-x"></span></button>')).toBe(false);
  });
});

describe('the phone scanner', () => {
  const flagged = (src) => scanMobileSource(src).length > 0;

  it('flags a hand-built icon-only touchable without a label shown on hold', () => {
    expect(flagged("<TouchableOpacity onPress={go}><Icon name='times' size={10} /></TouchableOpacity>")).toBe(true);
    expect(flagged("<Pressable onPress={go} accessibilityLabel='Close'><Icon name='times' /></Pressable>")).toBe(true);
  });

  it('accepts one with accessibilityLabel and onLongPress', () => {
    expect(
      flagged(
        "<Pressable onPress={() => go(1)} onLongPress={() => showLabel('Close')} accessibilityLabel='Close'><Icon name='times' /></Pressable>"
      )
    ).toBe(false);
  });

  it('leaves a touchable with visible text alone', () => {
    expect(flagged("<Pressable onPress={go}><Icon name='plus' /><Text>New tab</Text></Pressable>")).toBe(false);
    expect(flagged('<Pressable onPress={go}>{children}</Pressable>')).toBe(false);
  });
});
