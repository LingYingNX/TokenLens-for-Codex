"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

const hoverSource = [
  extract("codexPlusUsagePopoverHoverZone"),
  extract("codexPlusUsagePointInRect"),
  extract("codexPlusUsagePopoverPointerMove"),
].join("\n");

function rect(left, top, right, bottom) {
  return { left, top, right, bottom };
}

function createState(anchorRect, popoverRect, extra = {}) {
  return {
    hideTimer: 0,
    parts: { speed: { item: { getBoundingClientRect: () => anchorRect } } },
    popover: { hidden: false, getBoundingClientRect: () => popoverRect },
    ...extra,
  };
}

function compileHover(state, hideSoon, clearTimeoutFn) {
  return new Function(
    "codexPlusUsageState",
    "codexPlusUsageHidePopoverSoon",
    "clearTimeout",
    hoverSource + "\nreturn { zone: codexPlusUsagePopoverHoverZone, pointerMove: codexPlusUsagePopoverPointerMove };",
  )(state, hideSoon, clearTimeoutFn);
}

function compileHideSoon(state, { hovered = false, focusedInside = false } = {}) {
  const scheduled = [];
  const cleared = [];
  const popover = { hidden: false, matches: () => hovered, contains: () => focusedInside };
  state.popover = popover;
  const run = new Function(
    "codexPlusUsageState",
    "window",
    "clearTimeout",
    "codexPlusUsagePopoverHideMs",
    "document",
    extract("codexPlusUsageHidePopoverSoon") + "\nreturn codexPlusUsageHidePopoverSoon;",
  )(
    state,
    { setTimeout: (fn, ms) => scheduled.push({ fn, ms }) && scheduled.length },
    (id) => cleared.push(id),
    120,
    { activeElement: null },
  );
  return { run, scheduled, cleared, popover };
}

test("悬停区覆盖药丸与面板之间的空隙", () => {
  const state = createState(rect(100, 300, 160, 320), rect(40, 100, 320, 280));
  const { zone } = compileHover(state, () => {}, () => {});
  assert.deepEqual(zone(), rect(40, 100, 320, 320));
});

test("面板隐藏时不产生悬停区", () => {
  const state = createState(rect(100, 300, 160, 320), rect(40, 100, 320, 280));
  state.popover.hidden = true;
  const { zone } = compileHover(state, () => {}, () => {});
  assert.equal(zone(), null);
});

test("指针停在空隙里会取消隐藏倒计时", () => {
  const state = createState(rect(100, 300, 160, 320), rect(40, 100, 320, 280), { hideTimer: 9 });
  const cleared = [];
  let hideCalls = 0;
  const { pointerMove } = compileHover(
    state,
    () => {
      hideCalls += 1;
      state.hideTimer = 11;
    },
    (id) => cleared.push(id),
  );

  pointerMove({ clientX: 200, clientY: 290 });
  assert.equal(hideCalls, 0);
  assert.equal(state.hideTimer, 0);
  assert.deepEqual(cleared, [9]);
});

test("指针离开悬停区后才安排隐藏且不重复安排", () => {
  const state = createState(rect(100, 300, 160, 320), rect(40, 100, 320, 280));
  let hideCalls = 0;
  const { pointerMove } = compileHover(
    state,
    () => {
      hideCalls += 1;
      state.hideTimer = 11;
    },
    () => {},
  );

  pointerMove({ clientX: 900, clientY: 900 });
  assert.equal(hideCalls, 1);
  pointerMove({ clientX: 950, clientY: 950 });
  assert.equal(hideCalls, 1);
});

test("药丸右侧的横向空隙同样算悬停区", () => {
  const state = createState(rect(100, 100, 160, 120), rect(168, 100, 448, 400));
  let hideCalls = 0;
  const { pointerMove } = compileHover(state, () => { hideCalls += 1; }, () => {});

  pointerMove({ clientX: 164, clientY: 110 });
  assert.equal(hideCalls, 0);
});

test("隐藏倒计时结束后关闭面板并复位计时器", () => {
  const state = { hideTimer: 0 };
  const { run, scheduled, popover } = compileHideSoon(state);
  run();

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 120);
  scheduled[0].fn();
  assert.equal(popover.hidden, true);
  assert.equal(state.hideTimer, 0);
});

test("指针仍停在面板上时不关闭", () => {
  const state = { hideTimer: 0 };
  const { run, scheduled, popover } = compileHideSoon(state, { hovered: true });
  run();
  scheduled[0].fn();
  assert.equal(popover.hidden, false);
});

test("焦点留在面板内、指针已离开时仍会关闭", () => {
  const state = { hideTimer: 0 };
  const { run, scheduled, popover } = compileHideSoon(state, { focusedInside: true });
  run();
  scheduled[0].fn();

  assert.equal(popover.hidden, true);
  assert.equal(state.hideTimer, 0);
});
