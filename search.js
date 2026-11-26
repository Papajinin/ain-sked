// AIN Sked 일정 찾기 v3: 제목·메모로 찾기 (서랍장의 날짜 없는 할 일은 빼고)
//  - 결과를 꾹 누르면(0.5초) 수정 창이 검색 창 위에 열림. 저장·삭제하면 결과를 다시 그림
//  - 다가오는 일정(오늘 포함, 가까운 날부터)과 지난 일정(최근부터)으로 나눔
//  - 반복 일정은 묶음 하나를 카드 하나로: 규칙, 다음 날짜, 몇 번 했는지. 누르면 날짜 목록이 펼쳐짐
//  - 결과를 누르면 창을 닫고 달력이 그 날짜로 감

const searchOverlay = document.getElementById('searchOverlay');
const searchInput = document.getElementById('searchInput');
const searchRes = document.getElementById('searchRes');

let searchQ = '';
const searchOpen = new Set(); // 펼친 반복 카드 (seriesId)
const searchMore = new Set(); // "더 보기"를 누른 반복 카드
const SERIES_SHOW = 20; // 펼쳤을 때 처음 보여 줄 지난 날짜 수

// 찾은 글자를 테마 색 굵은 글씨로 (대문자·소문자 구분 없이, AIN Done과 같은 방식)
function markHtml(text, q) {
  const low = text.toLowerCase(), needle = q.toLowerCase();
  let out = '', i = 0, j;
  while ((j = low.indexOf(needle, i)) !== -1) {
    out += escapeHtml(text.slice(i, j)) + '<mark>' + escapeHtml(text.slice(j, j + q.length)) + '</mark>';
    i = j + q.length;
  }
  return out + escapeHtml(text.slice(i));
}

// 메모에서 찾은 곳이 보이게 앞부분을 줄여서 한 줄로
function memoSnippet(memo, q) {
  const flat = memo.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  const start = at > 14 ? at - 10 : 0;
  return (start ? '…' : '') + markHtml(flat.slice(start), q);
}

function hasText(s, needle) {
  return !!s && s.toLowerCase().includes(needle);
}

function sDate(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK_NAMES[d.getDay()]})`;
}
function sDateShort(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// 반복 규칙을 말로: 매일 / 매주 월·수·금 / 매월 15일
function ruleText(rule, first) {
  if (!rule) return '반복';
  if (rule.type === 'daily') return '매일';
  if (rule.type === 'monthly') return `매월 ${parseYmd(first).getDate()}일`;
  const order = state.settings.weekStart === 'sun' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
  return '매주 ' + order.filter(d => (rule.days || []).includes(d)).map(d => WEEK_NAMES[d]).join('·');
}

// 찾기: 한 번만 있는 일정은 하나씩, 반복은 묶음으로
function searchGroups(q) {
  const needle = q.toLowerCase();
  const singles = [];
  const series = new Map();
  state.tasks.forEach(t => {
    if (!t.date) return; // 서랍장의 날짜 없는 할 일은 빼기
    if (t.seriesId) {
      let g = series.get(t.seriesId);
      if (!g) series.set(t.seriesId, g = { sid: t.seriesId, all: [], hit: false });
      g.all.push(t);
      if (hasText(t.title, needle) || hasText(t.memo, needle)) g.hit = true;
    } else if (hasText(t.title, needle) || hasText(t.memo, needle)) {
      singles.push(t);
    }
  });

  const up = [], past = [];
  singles.forEach(t => (t.date >= ui.today ? up : past).push({ kind: 'one', key: t.date, t }));
  series.forEach(g => {
    if (!g.hit) return;
    g.all.sort((a, b) => a.date.localeCompare(b.date));
    const last = g.all[g.all.length - 1];
    const future = g.all.filter(t => t.date >= ui.today);
    if (future.length) {
      const next = future.find(t => !t.done) || future[0];
      up.push({ kind: 'series', key: next.date, g, next, last });
    } else {
      past.push({ kind: 'series', key: last.date, g, last });
    }
  });
  up.sort((a, b) => a.key.localeCompare(b.key));
  past.sort((a, b) => b.key.localeCompare(a.key));
  return { up, past };
}

// 한 줄: 카테고리 점(했으면 체크) + 제목 + (메모에서 찾았으면) 메모 한 줄
function sLine(t, q, title) {
  const needle = q.toLowerCase();
  const mark = t.done
    ? `<span class="s-check" style="color:${catColor(t.categoryId)}">${CHECK_SVG}</span>`
    : `<span class="t-dot" style="background:${catColor(t.categoryId)}"></span>`;
  const memo = hasText(t.memo, needle) ? `<div class="s-memo">메모: ${memoSnippet(t.memo, q)}</div>` : '';
  const skip = t.skipped && !t.done ? '<span class="skip-tag">넘김</span>' : '';
  return `<div class="s-line${t.done ? ' done' : ''}">${mark}<div class="s-text"><div class="s-title">${title}${skip}</div>${memo}</div></div>`;
}

function oneHtml(item, q) {
  const t = item.t;
  return `<button type="button" class="s-item" data-date="${t.date}" data-id="${t.id}">
      <div class="s-date${isRedDay(t.date) ? ' red' : ''}">${sDate(t.date)}</div>
      ${sLine(t, q, markHtml(t.title, q))}
    </button>`;
}

function seriesHtml(item, q) {
  const { g, last } = item;
  const first = g.all[0];
  const sample = item.next || last;
  const sofar = g.all.filter(t => t.date <= ui.today);
  const doneN = sofar.filter(t => t.done).length;
  const rule = ruleText(sample.repeat, first.date);
  const when = item.next ? `${rule} · ${sDateShort(last.date)}까지` : `${rule} · ${sDateShort(first.date)} ~ ${sDateShort(last.date)}`;
  const count = !sofar.length ? '' : item.next ? `지금까지 ${sofar.length}번 중 ${doneN}번 했어요` : `${sofar.length}번 중 ${doneN}번 했어요`;
  const open = searchOpen.has(g.sid);
  const needle = q.toLowerCase();
  const titleHit = hasText(sample.title, needle);

  let list = '';
  if (open) {
    // 앞으로 3번 (가까운 날부터) + 지난 날 (최근부터, 처음엔 20개까지)
    const ahead = g.all.filter(t => t.date > ui.today).slice(0, 3);
    const back = sofar.slice().reverse();
    const shown = searchMore.has(g.sid) ? back : back.slice(0, SERIES_SHOW);
    const row = t => {
      const tag = t.done ? `<span class="s-check" style="color:${catColor(t.categoryId)}">${CHECK_SVG}</span>`
        : t.skipped ? '<span class="skip-tag">넘김</span>' : '';
      const memo = hasText(t.memo, needle) ? `<div class="s-memo">메모: ${memoSnippet(t.memo, q)}</div>` : '';
      return `<button type="button" class="s-occ" data-date="${t.date}" data-id="${t.id}">
        <div class="s-occ-h"><span class="${isRedDay(t.date) ? 'red' : ''}">${sDate(t.date)}${t.date === ui.today ? ' · 오늘' : ''}</span>${tag}</div>${memo}
      </button>`;
    };
    list = `<div class="s-occs">${ahead.reverse().map(row).join('')}${shown.map(row).join('')}${back.length > shown.length
      ? `<button type="button" class="s-more" data-more="${g.sid}">${back.length - shown.length}개 더 보기</button>` : ''}</div>`;
  }

  return `<div class="s-series${open ? ' open' : ''}">
      <button type="button" class="s-item s-card" data-sid="${g.sid}" data-id="${sample.id}" aria-expanded="${open}">
        <div class="s-line">
          <span class="s-rep" aria-label="반복">↻</span>
          <span class="t-dot" style="background:${catColor(sample.categoryId)}"></span>
          <div class="s-text">
            <div class="s-title">${titleHit ? markHtml(sample.title, q) : escapeHtml(sample.title)}</div>
            <div class="s-sub">${when}</div>
            ${item.next ? `<div class="s-sub">다음: ${sDate(item.next.date)}</div>` : ''}
            ${count ? `<div class="s-sub">${count}</div>` : ''}
          </div>
          <svg class="s-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </button>
      ${list}
    </div>`;
}

function renderSearch() {
  const q = searchQ.trim();
  document.getElementById('searchClear').hidden = !searchQ;
  if (!q) {
    searchRes.innerHTML = '<p class="d-empty">제목이나 메모로 찾아요</p>';
    return;
  }
  const { up, past } = searchGroups(q);
  if (!up.length && !past.length) {
    searchRes.innerHTML = '<p class="d-empty">찾은 일정이 없어요</p>';
    return;
  }
  const item = it => it.kind === 'one' ? oneHtml(it, q) : seriesHtml(it, q);
  const sec = (title, arr) => arr.length
    ? `<section class="d-sec"><div class="d-sec-h">${title} · <b>${arr.length}개</b></div><div class="group s-list">${arr.map(item).join('')}</div></section>`
    : '';
  searchRes.innerHTML = sec('다가오는 일정', up) + sec('지난 일정', past);
}

function openSearch() {
  searchInput.value = searchQ;
  renderSearch();
  showOverlay(searchOverlay);
  // 열자마자 커서를 넣지 않음: 창이 아직 화면 아래에 있을 때 넣으면 아이폰이 화면 전체를 밀어 올림 (v13)
}

function closeSearch() {
  searchInput.blur();
  hideOverlay(searchOverlay);
}

searchInput.addEventListener('input', () => {
  searchQ = searchInput.value;
  searchOpen.clear();
  searchMore.clear();
  renderSearch();
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') searchInput.blur(); // 키보드 내리기
  if (e.key === 'Escape') closeSearch();
});
document.getElementById('searchClear').addEventListener('click', () => {
  searchQ = '';
  searchInput.value = '';
  searchOpen.clear();
  searchMore.clear();
  renderSearch();
  searchInput.focus();
});

searchRes.addEventListener('click', e => {
  if (Date.now() - longPressedAt < 600) return; // 꾹 누른 뒤 손을 뗄 때 생기는 클릭은 무시
  const more = e.target.closest('[data-more]');
  if (more) {
    searchMore.add(more.dataset.more);
    renderSearch();
    return;
  }
  const card = e.target.closest('[data-sid]');
  if (card) {
    const sid = card.dataset.sid;
    if (searchOpen.has(sid)) searchOpen.delete(sid);
    else searchOpen.add(sid);
    renderSearch();
    return;
  }
  const go = e.target.closest('[data-date]');
  if (!go) return;
  closeSearch();
  selectDate(go.dataset.date);
});

document.getElementById('searchBtn').addEventListener('click', openSearch);
document.getElementById('searchClose').addEventListener('click', closeSearch);
searchOverlay.addEventListener('click', e => { if (e.target === searchOverlay) closeSearch(); });

// ---------- 꾹 누르기 (0.5초) → 수정 창 (반복 카드는 다음 날짜, 끝난 반복은 마지막 날짜) ----------
let sPress = null;
function cancelSearchPress() {
  if (!sPress) return;
  clearTimeout(sPress.timer);
  sPress.el.classList.remove('pressing');
  sPress = null;
}
searchRes.addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-id]');
  if (!el || e.button > 0) return;
  cancelSearchPress();
  el.classList.add('pressing');
  sPress = {
    el, x: e.clientX, y: e.clientY,
    timer: setTimeout(() => {
      const id = el.dataset.id;
      cancelSearchPress();
      longPressedAt = Date.now();
      searchInput.blur();
      if (findTask(id)) openSheet(id);
    }, 500)
  };
});
searchRes.addEventListener('pointermove', e => {
  if (sPress && Math.hypot(e.clientX - sPress.x, e.clientY - sPress.y) > 10) cancelSearchPress();
});
searchRes.addEventListener('pointerup', cancelSearchPress);
searchRes.addEventListener('pointercancel', cancelSearchPress);
searchRes.addEventListener('pointerleave', cancelSearchPress);
searchRes.parentElement.addEventListener('scroll', cancelSearchPress, { passive: true });
searchRes.addEventListener('contextmenu', e => { if (e.target.closest('[data-id]')) e.preventDefault(); });

// 수정 창에서 저장·삭제하면 (renderAll이 부름) 열려 있는 검색 결과도 새로
function refreshSearch() {
  if (searchOverlay.hidden || !searchOverlay.classList.contains('show')) return;
  renderSearch();
}
function searchIsOpen() {
  return !searchOverlay.hidden && searchOverlay.classList.contains('show');
}
