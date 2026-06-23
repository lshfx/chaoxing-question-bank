// ==UserScript==
// @name         超星可见题目本地题库助手
// @namespace    local.chaoxing.visible-question-bank
// @version      0.1.6
// @description  采集当前超星页面中已经可见的题目、答案和解析，保存为本地复习题库，支持导出 JSON/Markdown/CSV。
// @author       Codex
// @match        *://*.chaoxing.com/exam-ans/exam/test/*
// @match        *://*.chaoxing.com/exam/test/*
// @match        *://*.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mooc-ans/knowledge/cards*
// @match        *://*.chaoxing.com/mooc-ans/mooc2/work/view*
// @match        *://*.chaoxing.com/mooc-ans/mooc2/work/dowork*
// @match        file:///*/test1.html
// @match        file:///*/test2.html
// @match        file:///*/test3.html
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

;(function () {
  'use strict'

  const STORE_KEY = 'cx_visible_question_bank_v1'
  const TARGET_LIBRARY_KEY = 'cx_visible_question_target_library_v1'
  const PANEL_ID = 'cx-qb-panel'
  // 发布到网上后，把这里改成你的练习网站地址，例如：
  // https://your-name.github.io/chaoxing-question-bank/question-bank-practice.html
  const PRACTICE_SITE_URL = 'https://lshfx.github.io/chaoxing-question-bank/'

  const state = {
    lastScan: [],
  }

  function normalizeText(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function normalizeMultiline(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  function textOf(el) {
    return el ? normalizeText(el.innerText || el.textContent || '') : ''
  }

  function htmlOf(el) {
    return el ? el.innerHTML.trim() : ''
  }

  function isVisible(el) {
    if (!el || !el.ownerDocument) return false
    const win = el.ownerDocument.defaultView
    let node = el
    while (node && node.nodeType === 1) {
      const style = win.getComputedStyle(node)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      ) {
        return false
      }
      node = node.parentElement
    }
    return true
  }

  function visibleTextList(root, selector) {
    return Array.from(root.querySelectorAll(selector))
      .filter(isVisible)
      .map(textOf)
      .filter(Boolean)
  }

  function getPaperTitle(rootDoc = document) {
    return (
      textOf(rootDoc.querySelector('.mark_title')) ||
      textOf(document.querySelector('.mark_title')) ||
      document.title ||
      '超星题库'
    )
  }

  function getSectionTitle(questionEl) {
    let node = questionEl.previousElementSibling
    while (node) {
      if (node.matches && node.matches('.type_tit')) return textOf(node)
      node = node.previousElementSibling
    }
    const parentTitle = questionEl
      .closest('.mark_item')
      ?.querySelector('.type_tit')
    return textOf(parentTitle)
  }

  function parseMeta(questionEl) {
    const metaText = textOf(
      questionEl.querySelector('.mark_name .colorShallow'),
    )
    const fullText = textOf(questionEl.querySelector('.mark_name')) || textOf(questionEl)
    const match = metaText.match(
      /[（(]\s*([^,，)）]+)\s*[,，]\s*([\d.]+)\s*分\s*[)）]/,
    )
    const inlineType = fullText.match(/[（(【\[]\s*(单选题|多选题|判断题|填空题|简答题|问答题|论述题)\s*[】\])）]/)
    return {
      type: match ? match[1] : (inlineType ? inlineType[1] : metaText.replace(/[()（）]/g, '')),
      score: match ? Number(match[2]) : null,
    }
  }

  function isJudgeType(type) {
    return /判断/.test(type || '')
  }

  function judgeOptions() {
    return [
      { key: 'A', text: '对', raw: 'A. 对', html: 'A. 对' },
      { key: 'B', text: '错', raw: 'B. 错', html: 'B. 错' },
    ]
  }


  function getTargetLibraryName() {
    const input = document.querySelector(`#${PANEL_ID} .cx-qb-library-input`)
    const value = normalizeText(input?.value)
    const fallback = getPaperTitle()
    const name = value || localStorage.getItem(TARGET_LIBRARY_KEY) || fallback
    return normalizeText(name) || '默认题库'
  }

  function saveTargetLibraryName() {
    const input = document.querySelector(`#${PANEL_ID} .cx-qb-library-input`)
    const name = normalizeText(input?.value)
    if (name) localStorage.setItem(TARGET_LIBRARY_KEY, name)
    return name
  }

  function applyTargetLibrary(items, libraryName = getTargetLibraryName()) {
    const name = normalizeText(libraryName) || '默认题库'
    return (items || []).map((item) => ({
      ...item,
      libraryName: name,
    }))
  }
  function parseQuestionNo(questionEl) {
    const h3 = questionEl.querySelector('.mark_name')
    if (!h3) return ''
    const firstText = Array.from(h3.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(' ')
    const match = firstText.match(/(\d+)\s*[.．、]/)
    return match ? match[1] : ''
  }

  function parseOptions(questionEl) {
    return Array.from(questionEl.querySelectorAll('.qtDetail li'))
      .filter(isVisible)
      .map((li, index) => {
        const raw = textOf(li)
        const match = raw.match(/^([A-Z])\s*[.．、]\s*(.*)$/i)
        return {
          key: match ? match[1].toUpperCase() : String.fromCharCode(65 + index),
          text: match ? normalizeText(match[2]) : raw,
          raw,
          html: htmlOf(li),
        }
      })
  }

  function getImageUrls(questionEl) {
    return Array.from(questionEl.querySelectorAll('img'))
      .filter(isVisible)
      .map(
        (img) =>
          img.getAttribute('data-original') ||
          img.currentSrc ||
          img.src ||
          img.getAttribute('src'),
      )
      .filter(Boolean)
      .map((src) => new URL(src, location.href).href)
  }

  function getStableHash(input) {
    let hash = 2166136261
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return `q_${(hash >>> 0).toString(16).padStart(8, '0')}`
  }

  function parseQuestion(questionEl, rootDoc = questionEl.ownerDocument || document) {
    const meta = parseMeta(questionEl)
    const qtContent = questionEl.querySelector('.qtContent')
    const options = parseOptions(questionEl)
    const studentAnswers = visibleTextList(questionEl, '.stuAnswerContent')
    const rightAnswers = visibleTextList(questionEl, '.rightAnswerContent')
    const analysis = visibleTextList(questionEl, '.qtAnalysis').join('\n')
    const questionText = normalizeMultiline(
      qtContent?.innerText || qtContent?.textContent || '',
    )
    const rawId = questionEl.getAttribute('data') || questionEl.id || ''
    const section = getSectionTitle(questionEl)
    const source = getPaperTitle(rootDoc)
    const hashInput = [
      meta.type,
      questionText,
      options.map((item) => item.raw).join('|'),
    ].join('\n')

    return {
      id: getStableHash(hashInput),
      platformId: rawId,
      source,
      section,
      number: parseQuestionNo(questionEl),
      type: meta.type,
      score: meta.score,
      question: questionText,
      questionHtml: htmlOf(qtContent),
      options: isJudgeType(meta.type) && !options.length ? judgeOptions() : options,
      myAnswer: studentAnswers.join('; '),
      correctAnswer: rightAnswers.join('; '),
      analysis: normalizeMultiline(analysis),
      imageUrls: getImageUrls(questionEl),
      pageUrl: location.href,
      capturedAt: new Date().toISOString(),
    }
  }

  function scanVisibleQuestions() {
    return getScanDocuments()
      .flatMap((rootDoc) => [
        ...Array.from(rootDoc.querySelectorAll('.questionLi')).map((questionEl) => ({
          questionEl,
          rootDoc,
          parser: 'exam',
        })),
        ...getLegacyQuestionEntries(rootDoc),
      ])
      .filter(({ questionEl }) => isVisible(questionEl))
      .map(({ questionEl, rootDoc, parser }) =>
        parser === 'legacy'
          ? parseLegacyWorkQuestion(questionEl, rootDoc)
          : parseQuestion(questionEl, rootDoc),
      )
      .filter(
        (item) =>
          item.question ||
          item.options.length ||
          item.correctAnswer ||
          item.myAnswer,
      )
  }

  function getScanDocuments() {
    const docs = [document]
    const visit = (rootDoc) => {
      Array.from(rootDoc.querySelectorAll('iframe')).forEach((iframe) => {
        try {
          const frameDoc =
            iframe.contentDocument || iframe.contentWindow?.document
          if (frameDoc && !docs.includes(frameDoc)) {
            docs.push(frameDoc)
            visit(frameDoc)
          }
        } catch (error) {
          console.debug('[超星题库助手] iframe 不可访问，已跳过', error)
        }
      })
    }
    visit(document)
    return docs
  }

  function diagnosePage() {
    const selectors = [
      '.questionLi',
      '.qtContent',
      '.TiMu',
      '.Zy_TItle',
      '.Zy_ulTop li',
      '.Py_answer',
      '.ans-job-icon',
      'iframe',
    ]
    const docs = getScanDocuments()
    const lines = docs.map((doc, index) => {
      const url = doc.location?.href || 'about:blank'
      const counts = selectors
        .map((selector) => `${selector}:${doc.querySelectorAll(selector).length}`)
        .join(' ')
      return `文档${index + 1}: ${counts}\n${url}`
    })
    return `可访问文档 ${docs.length} 个\n${lines.join('\n\n')}`
  }

  function parseLegacyWorkOptions(questionEl) {
    return Array.from(
      questionEl.querySelectorAll('.Zy_ulTop li, .Zy_ul li, .option li, .answerList li'),
    )
      .filter(isVisible)
      .map((li, index) => {
        const raw = textOf(li)
        const match = raw.match(/^([A-Z])\s*[.．、]?\s*(.*)$/i)
        return {
          key: match ? match[1].toUpperCase() : String.fromCharCode(65 + index),
          text: match ? normalizeText(match[2]) : raw,
          raw,
          html: htmlOf(li),
        }
      })
      .filter((option) => option.text)
  }

  function extractLabelText(root, labels) {
    const text = root.innerText || root.textContent || ''
    for (const label of labels) {
      const pattern = new RegExp(`${label}[：:]\\s*([^\\n\\r]+)`)
      const match = text.match(pattern)
      if (match) return normalizeText(match[1])
    }
    return ''
  }

  function parseLegacyWorkQuestion(questionEl, rootDoc = questionEl.ownerDocument || document) {
    const titleEl =
      questionEl.querySelector('.Zy_TItle') ||
      questionEl.querySelector('.Cy_TItle') ||
      questionEl.querySelector('.TiMu_TItle')
    const rawTitle = textOf(titleEl || questionEl)
    const metaMatch = rawTitle.match(/[（(【\[]?\s*(单选题|多选题|判断题|填空题|简答题|问答题|论述题)/)
    const scoreMatch = rawTitle.match(/([\d.]+)\s*分/)
    const type = metaMatch ? metaMatch[1] : ''
    const question = normalizeMultiline(
      rawTitle
        .replace(/^\s*\d+\s*[.．、]/, '')
        .replace(/[（(【\[]?\s*(单选题|多选题|判断题|填空题|简答题|问答题|论述题).*?[）)】\]]?/, '')
        .trim(),
    )
    const options = parseLegacyWorkOptions(questionEl)
    const correctAnswer =
      textOf(questionEl.querySelector('.rightAnswerContent')) ||
      textOf(questionEl.querySelector('.Py_answer')) ||
      textOf(questionEl.querySelector('.rightAnswer')) ||
      textOf(questionEl.querySelector('.correctAnswer')) ||
      extractLabelText(questionEl, ['正确答案', '参考答案'])
    const myAnswer =
      textOf(questionEl.querySelector('.stuAnswerContent')) ||
      textOf(questionEl.querySelector('.myAnswer')) ||
      textOf(questionEl.querySelector('.stuAnswer')) ||
      extractLabelText(questionEl, ['我的答案', '学生答案'])
    const analysis =
      textOf(questionEl.querySelector('.qtAnalysis')) ||
      textOf(questionEl.querySelector('.analysis')) ||
      textOf(questionEl.querySelector('.Py_jiexi')) ||
      extractLabelText(questionEl, ['答案解析', '解析'])
    const hashInput = [type, question, options.map((item) => item.raw).join('|')].join('\n')
    return {
      id: getStableHash(hashInput),
      platformId: questionEl.id || questionEl.getAttribute('data') || '',
      source: getPaperTitle(rootDoc),
      section: '',
      number: parseQuestionNo(questionEl),
      type,
      score: scoreMatch ? Number(scoreMatch[1]) : null,
      question,
      questionHtml: htmlOf(titleEl),
      options: isJudgeType(type) && !options.length ? judgeOptions() : options,
      myAnswer,
      correctAnswer,
      analysis,
      imageUrls: getImageUrls(questionEl),
      pageUrl: rootDoc.location?.href || location.href,
      capturedAt: new Date().toISOString(),
    }
  }

  function getLegacyQuestionEntries(rootDoc) {
    const containers = new Set()
    rootDoc.querySelectorAll('.Zy_TItle, .Cy_TItle, .TiMu_TItle').forEach((title) => {
      const container = title.closest('.TiMu') || title.parentElement
      if (container) containers.add(container)
    })
    rootDoc.querySelectorAll('.TiMu').forEach((item) => {
      try {
        if (
          item.querySelector('.Zy_TItle, .Cy_TItle, .TiMu_TItle') &&
          !item.querySelector('.questionLi')
        ) {
          containers.add(item)
        }
      } catch (error) {
        console.debug('[超星题库助手] 旧版题目容器解析失败', error)
      }
    })
    return Array.from(containers).map((questionEl) => ({
      questionEl,
      rootDoc,
      parser: 'legacy',
    }))
  }

  function loadBank() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY) || '[]')
      return Array.isArray(data) ? data : []
    } catch (error) {
      console.warn('[超星题库助手] 读取本地题库失败', error)
      return []
    }
  }

  function saveBank(items) {
    localStorage.setItem(STORE_KEY, JSON.stringify(items))
  }

  function mergeQuestions(existing, incoming) {
    const map = new Map(existing.map((item) => [item.id, item]))
    let added = 0
    let updated = 0

    incoming.forEach((item) => {
      const old = map.get(item.id)
      if (!old) {
        map.set(item.id, item)
        added += 1
        return
      }

      const merged = {
        ...old,
        ...item,
        myAnswer: item.myAnswer || old.myAnswer,
        correctAnswer: item.correctAnswer || old.correctAnswer,
        analysis: item.analysis || old.analysis,
        questionHtml: item.questionHtml || old.questionHtml,
        imageUrls: Array.from(
          new Set([...(old.imageUrls || []), ...(item.imageUrls || [])]),
        ),
        capturedAt: item.capturedAt,
      }
      map.set(item.id, merged)
      updated += 1
    })

    return {
      items: Array.from(map.values()),
      added,
      updated,
    }
  }

  function escapeMarkdown(text) {
    return String(text || '').replace(/\|/g, '\\|')
  }

  function toMarkdown(items) {
    return items
      .map((item, index) => {
        const lines = []
        lines.push(`## ${index + 1}. [${item.type || '题目'}] ${item.question}`)
        lines.push('')
        if (item.options?.length) {
          item.options.forEach((option) =>
            lines.push(`- ${option.key}. ${option.text}`),
          )
          lines.push('')
        }
        if (item.myAnswer) lines.push(`我的答案：${item.myAnswer}`)
        if (item.correctAnswer) lines.push(`正确答案：${item.correctAnswer}`)
        if (item.analysis) lines.push(`解析：${item.analysis}`)
        if (item.libraryName) lines.push(`题库：${item.libraryName}`)
        if (item.source) lines.push(`来源：${item.source}`)
        if (item.section) lines.push(`分组：${item.section}`)
        if (item.imageUrls?.length) {
          lines.push('图片：')
          item.imageUrls.forEach((url) => lines.push(`- ${url}`))
        }
        return lines.join('\n')
      })
      .join('\n\n---\n\n')
  }

  function toCsv(items) {
    const headers = [
      'id',
      'source',
      'libraryName',
      'section',
      'number',
      'type',
      'score',
      'question',
      'options',
      'myAnswer',
      'correctAnswer',
      'analysis',
      'pageUrl',
      'capturedAt',
    ]
    const rows = items.map((item) =>
      headers
        .map((key) => {
          const value =
            key === 'options'
              ? item.options
                  .map((option) => `${option.key}. ${option.text}`)
                  .join('\n')
              : item[key]
          return `"${String(value ?? '').replace(/"/g, '""')}"`
        })
        .join(','),
    )
    return [`\uFEFF${headers.join(',')}`, ...rows].join('\n')
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text')
      return Promise.resolve()
    }
    return navigator.clipboard.writeText(text)
  }

  function buildPracticePayload(items) {
    return {
      type: 'cx-question-bank-import',
      version: 1,
      source: 'chaoxing-visible-question-bank.user.js',
      sentAt: new Date().toISOString(),
      bank: items,
    }
  }

  function openPracticeSite(items) {
    if (!items.length) {
      setStatus('没有可发送的题目，请先扫描或保存。')
      return
    }
    if (!PRACTICE_SITE_URL || PRACTICE_SITE_URL.includes('example.com')) {
      setStatus('请先在脚本中配置 PRACTICE_SITE_URL 为你的练习网站地址。')
      return
    }
    const payload = buildPracticePayload(items)
    const target = window.open(PRACTICE_SITE_URL, '_blank')
    if (!target) {
      setStatus('浏览器拦截了弹窗，请允许打开练习网站。')
      return
    }

    let attempts = 0
    const timer = window.setInterval(() => {
      attempts += 1
      target.postMessage(payload, '*')
      if (attempts >= 20) window.clearInterval(timer)
    }, 500)
    setStatus(`已打开练习网站，正在发送 ${items.length} 题。`)
  }

  function filename(ext) {
    const title =
      getPaperTitle()
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 50) || 'chaoxing-question-bank'
    const date = new Date().toISOString().slice(0, 10)
    return `${title}_${date}.${ext}`
  }

  function setStatus(text) {
    const status = document.querySelector(`#${PANEL_ID} .cx-qb-status`)
    if (status) status.textContent = text
  }

  function renderPreview(items) {
    const preview = document.querySelector(`#${PANEL_ID} .cx-qb-preview`)
    if (!preview) return
    preview.innerHTML = ''
    const shown = items.slice(0, 5)
    shown.forEach((item) => {
      const row = document.createElement('div')
      row.className = 'cx-qb-item'
      row.innerHTML = `
        <div class="cx-qb-item-title">${item.number ? `${item.number}. ` : ''}${item.type || ''}</div>
        <div class="cx-qb-item-q">${escapeHtml(item.question).slice(0, 90)}</div>
        <div class="cx-qb-item-a">答案：${escapeHtml(item.correctAnswer || item.myAnswer || '暂无')}</div>
      `
      preview.appendChild(row)
    })
    if (items.length > shown.length) {
      const more = document.createElement('div')
      more.className = 'cx-qb-more'
      more.textContent = `还有 ${items.length - shown.length} 题未显示，可导出查看。`
      preview.appendChild(more)
    }
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function injectStyle() {
    const style = document.createElement('style')
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        width: 320px;
        box-sizing: border-box;
        padding: 12px;
        border: 1px solid #d8e2f0;
        border-radius: 8px;
        background: #fff;
        color: #1f2937;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
        font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      }
      #${PANEL_ID}.cx-qb-min .cx-qb-body { display: none; }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .cx-qb-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
        font-weight: 700;
      }
      #${PANEL_ID} .cx-qb-min-btn {
        width: 24px;
        height: 24px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: #f9fafb;
        cursor: pointer;
      }
      #${PANEL_ID} .cx-qb-field {
        margin-bottom: 8px;
      }
      #${PANEL_ID} .cx-qb-field label {
        display: block;
        margin-bottom: 4px;
        color: #4b5563;
        font-size: 12px;
      }
      #${PANEL_ID} .cx-qb-library-input {
        width: 100%;
        min-height: 32px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 0 8px;
        color: #111827;
      }
      #${PANEL_ID} .cx-qb-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      #${PANEL_ID} button {
        min-height: 32px;
        border: 1px solid #3b82f6;
        border-radius: 6px;
        background: #eff6ff;
        color: #1d4ed8;
        cursor: pointer;
      }
      #${PANEL_ID} button:hover { background: #dbeafe; }
      #${PANEL_ID} button.cx-qb-danger {
        border-color: #fca5a5;
        background: #fff1f2;
        color: #be123c;
      }
      #${PANEL_ID} .cx-qb-status {
        min-height: 20px;
        margin: 8px 0;
        color: #4b5563;
      }
      #${PANEL_ID} .cx-qb-preview {
        max-height: 260px;
        overflow: auto;
        border-top: 1px solid #eef2f7;
        padding-top: 8px;
      }
      #${PANEL_ID} .cx-qb-item {
        padding: 8px 0;
        border-bottom: 1px solid #eef2f7;
      }
      #${PANEL_ID} .cx-qb-item-title {
        font-weight: 700;
        color: #111827;
      }
      #${PANEL_ID} .cx-qb-item-q,
      #${PANEL_ID} .cx-qb-item-a,
      #${PANEL_ID} .cx-qb-more {
        margin-top: 3px;
        color: #4b5563;
        font-size: 12px;
      }
    `
    document.head.appendChild(style)
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return
    injectStyle()
    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.innerHTML = `
      <div class="cx-qb-head">
        <span>超星本地题库</span>
        <button class="cx-qb-min-btn" title="收起/展开">-</button>
      </div>
      <div class="cx-qb-body">
        <div class="cx-qb-field">
          <label>合并到题库</label>
          <input class="cx-qb-library-input" type="text" placeholder="例如：软件项目管理">
        </div>
        <div class="cx-qb-actions">
          <button data-action="scan">扫描本页</button>
          <button data-action="save">保存去重</button>
          <button data-action="json">导出 JSON</button>
          <button data-action="md">导出 Markdown</button>
          <button data-action="csv">导出 CSV</button>
          <button data-action="copy">复制 Markdown</button>
          <button data-action="practice">发送到网站</button>
          <button data-action="diagnose">诊断结构</button>
          <button data-action="show">查看题库</button>
          <button data-action="clear" class="cx-qb-danger">清空题库</button>
        </div>
        <div class="cx-qb-status">已加载，本地题库 ${loadBank().length} 题。</div>
        <div class="cx-qb-preview"></div>
      </div>
    `
    document.body.appendChild(panel)
    const libraryInput = panel.querySelector('.cx-qb-library-input')
    libraryInput.value = localStorage.getItem(TARGET_LIBRARY_KEY) || getPaperTitle()
    libraryInput.addEventListener('change', () => {
      const name = saveTargetLibraryName()
      if (name) setStatus(`之后扫描会合并到题库：${name}`)
    })

    panel.querySelector('.cx-qb-min-btn').addEventListener('click', () => {
      panel.classList.toggle('cx-qb-min')
    })

    panel.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]')
      if (!button) return
      await handleAction(button.dataset.action)
    })
  }

  async function handleAction(action) {
    const bank = loadBank()
    if (action === 'scan') {
      saveTargetLibraryName()
      state.lastScan = applyTargetLibrary(scanVisibleQuestions())
      renderPreview(state.lastScan)
      setStatus(`本页扫描到 ${state.lastScan.length} 题，将合并到“${getTargetLibraryName()}”。`)
      return
    }

    if (action === 'save') {
      saveTargetLibraryName()
      const scanned = applyTargetLibrary(state.lastScan.length
        ? state.lastScan
        : scanVisibleQuestions())
      const result = mergeQuestions(bank, scanned)
      saveBank(result.items)
      state.lastScan = scanned
      renderPreview(scanned)
      setStatus(
        `已保存：新增 ${result.added} 题，更新 ${result.updated} 题；题库共 ${result.items.length} 题。`,
      )
      return
    }

    if (action === 'show') {
      renderPreview(bank)
      setStatus(`本地题库共 ${bank.length} 题。`)
      return
    }

    if (action === 'json') {
      download(
        filename('json'),
        JSON.stringify(bank, null, 2),
        'application/json;charset=utf-8',
      )
      setStatus(`已导出 JSON：${bank.length} 题。`)
      return
    }

    if (action === 'md') {
      download(filename('md'), toMarkdown(bank), 'text/markdown;charset=utf-8')
      setStatus(`已导出 Markdown：${bank.length} 题。`)
      return
    }

    if (action === 'csv') {
      download(filename('csv'), toCsv(bank), 'text/csv;charset=utf-8')
      setStatus(`已导出 CSV：${bank.length} 题。`)
      return
    }

    if (action === 'copy') {
      await copyText(toMarkdown(bank))
      setStatus(`已复制 Markdown：${bank.length} 题。`)
      return
    }

    if (action === 'practice') {
      saveTargetLibraryName()
      const scanned = applyTargetLibrary(state.lastScan.length
        ? state.lastScan
        : scanVisibleQuestions())
      const result = mergeQuestions(bank, scanned)
      saveBank(result.items)
      state.lastScan = scanned
      renderPreview(scanned)
      openPracticeSite(result.items)
      return
    }

    if (action === 'diagnose') {
      const report = diagnosePage()
      console.log('[超星题库助手] 页面结构诊断\n' + report)
      await copyText(report)
      setStatus('诊断信息已复制，也已输出到控制台。')
      return
    }

    if (action === 'clear') {
      const confirmed = window.confirm(
        '确定清空本地题库吗？这个操作只清空浏览器本地保存的数据。',
      )
      if (!confirmed) return
      saveBank([])
      state.lastScan = []
      renderPreview([])
      setStatus('本地题库已清空。')
    }
  }

  function boot() {
    if (!document.querySelector('.questionLi, #iframe, iframe[src*="knowledge/cards"]')) return
    createPanel()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
})()
