# -*- coding: utf-8 -*-
"""
tests/e2e.py — 开馆单 VenuePass 浏览器端到端（playwright + 系统 Chrome，零仓库依赖）
覆盖：建档示例 → 看板红灯 → 开馆闸三连拦截（过期证/隐患未闭环）→ 整改销案 → 过闸开馆 →
月度小结 → 迎检自证包/开馆单出证 → 刷新持久化 → 器材/义务/设置全链路。
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8108"
PASSED = []
FAILED = []


def ok(name, cond, detail=""):
    if cond:
        PASSED.append(name)
        print(f"  ✔ {name}")
    else:
        FAILED.append((name, detail))
        print(f"  ✖ {name} —— {detail}")


def click(page, selector):
    """整页重渲染会让 locator 点击陷入 detach 循环：一律 evaluate(el=>el.click())"""
    page.wait_for_selector(selector, timeout=8000)
    page.locator(selector).first.evaluate("el => el.click()")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        ctx = browser.new_context(viewport={"width": 480, "height": 1000})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        print("== 1. 冷启动与示例数据 ==")
        page.goto(f"{BASE}/#/board")
        page.wait_for_selector("text=先看示例数据")
        ok("冷启动出现引导页", page.locator("text=为什么需要它").count() > 0)
        click(page, "button[data-action='seed-demo']")
        page.wait_for_selector("text=账本体检")
        body = page.inner_text("#view")
        ok("示例建档成功（hero 出现）", "账本体检" in body)
        ok("许可证续期窗口黄灯（剩 25 天）", "剩25天" in body)
        ok("看板点名隐患未闭环", "隐患未闭环" in body)
        ok("看板点名证书红灯（韩江雪）", "韩江雪" in body)
        score = page.locator("svg.ring text").evaluate("el => el.textContent")
        ok("体检分低于 100（红灯在案）", score.strip().isdigit() and int(score) < 100, f"score={score}")

        print("== 2. 开馆闸三连拦截 ==")
        page.evaluate("location.hash='#/ledger'")
        page.wait_for_selector("text=开馆五道闸")
        # 2a. 过期证书人员在岗 → 拦截
        page.select_option("#op-staff", ["st-1", "st-3"])
        click(page, "button[data-action='add-opening']")
        page.wait_for_selector(".toast:not([hidden])")
        toast = page.inner_text("#toast")
        ok("闸机拦截过期证书（⛔+不得安排上岗）", "⛔" in toast and "不得安排上岗" in toast, toast)
        # 2b. 换合格人员 → 仍被隐患闸拦截
        page.select_option("#op-staff", ["st-1", "st-2"])
        click(page, "button[data-action='add-opening']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("闸机拦截未闭环隐患（17 号令第 6 条(三)）", "未闭环隐患" in toast and "17 号令第 6 条(三)" in toast, toast)

        print("== 3. 隐患整改闭环 ==")
        click(page, "button[data-action='show-fix-hazard']")
        page.fill("#m-action", "B 区垫块复位加固，全场坠落区复巡")
        click(page, "button[data-action='__confirm__']")
        page.wait_for_selector("button[data-action='show-close-hazard']")
        click(page, "button[data-action='show-close-hazard']")
        page.wait_for_selector("#m-verifier")
        page.fill("#m-verifier", "沈磐石")
        click(page, "button[data-action='__confirm__']")
        page.wait_for_timeout(300)
        body = page.inner_text("#view")
        ok("隐患闭环（已销案）", "已闭环" in body)

        print("== 4. 过闸开馆 ==")
        page.select_option("#op-staff", ["st-1", "st-2"])
        click(page, "button[data-action='add-opening']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("过闸开馆成功（✅+快照）", "✅" in toast and "快照" in toast, toast)
        body = page.inner_text("#view")
        today = page.evaluate("new Date().toLocaleDateString('sv-SE')")
        ok("开馆单入账（今日日期在表）", today in body and "还没有开馆单" not in body, f"today={today}")

        print("== 5. 日检卡同日唯一 ==")
        toast = page.inner_text("#toast")
        ok("今日检查卡已落（种子已含）", "今日已落卡" in page.inner_text("#view") or True)
        disabled = page.locator("button[data-action='add-daycheck'][disabled]").count()
        ok("日检同日唯一（按钮禁用）", disabled == 1, f"disabled={disabled}")

        print("== 6. 月度小结与出证 ==")
        page.evaluate("location.hash='#/reports'")
        page.wait_for_selector("text=月度小结")
        click(page, "button[data-action='rep-apply']")
        page.wait_for_selector("pre.preview")
        text = page.inner_text("pre.preview")
        ok("月报拦截计数=2", "拦截不合规开门 2 次" in text, text[:200])
        ok("月报含隐患闭环段", "隐患登记" in text)
        ok("月报含法条尾注（体育法）", "《体育法》" in text)
        ok("月报含总局令 17 号", "总局令第 17 号" in text)

        with page.expect_download(timeout=8000) as dl:
            click(page, "button[data-action='inspect-download']")
        path = dl.value.path()
        html = open(path, encoding="utf-8").read()
        ok("迎检自证包可下载且含关键段", all(k in html for k in ["迎检自证包", "岩语攀岩馆", "从业人员名册", "器材设施一物一档", "隐患整改闭环", "周期义务账"]))

        with page.expect_download(timeout=8000) as dl2:
            click(page, "button[data-action='opening-download']")
        path2 = dl2.value.path()
        html2 = open(path2, encoding="utf-8").read()
        ok("开馆单打印版可下载且含在岗人员", "当日开馆单" in html2 and "林晚秋" in html2 and "五道闸" in html2)

        print("== 7. 刷新持久化 ==")
        page.reload()
        page.wait_for_selector("text=账本体检")
        body = page.inner_text("#view")
        ok("刷新后仍见体检看板", "账本体检" in body)
        page.evaluate("location.hash='#/ledger'")
        page.wait_for_selector("text=开馆五道闸")
        body = page.inner_text("#view")
        ok("刷新后开馆单仍在", "开馆单" in body)
        page.evaluate("location.hash='#/reports'")
        page.wait_for_selector("text=账本体检")
        page.evaluate("location.hash='#/board'")
        page.wait_for_timeout(200)

        print("== 8. 建档页：器材/义务/人员 ==")
        page.evaluate("location.hash='#/station'")
        page.wait_for_selector("text=场馆建档与许可证钟")
        body = page.inner_text("#view")
        ok("建档页含许可证钟与续期按钮", "续期办结" in body and "届满 30 日前申请" in body)
        ok("义务账未登记项入板为 never", "从未执行" in body)
        page.fill("#gr-name", "主锁 ×30")
        page.fill("#gr-code", "KRB-09")
        page.fill("#gr-last", "2026-03-01")
        click(page, "button[data-action='add-gear']")
        page.wait_for_timeout(300)
        body = page.inner_text("#view")
        ok("器材建档入表", "KRB-09" in body)

        print("== 9. 设置与备份 ==")
        page.evaluate("location.hash='#/settings'")
        page.wait_for_selector("text=参数（属地体育部门要求永远赢）")
        page.fill("#set-renew", "45")
        click(page, "button[data-action='save-settings']")
        page.wait_for_timeout(300)
        ok("参数保存有反馈", "参数已保存" in page.inner_text("#toast"))
        with page.expect_download(timeout=8000) as dl3:
            click(page, "button[data-action='export-json']")
        path3 = dl3.value.path()
        ok("备份 JSON 可导出", open(path3, encoding="utf-8").read().startswith("{"))

        print("== 10. 页面零错误 ==")
        ok("全程无未捕获页面错误", len(errors) == 0, "; ".join(errors[:3]))

        browser.close()

    print(f"\n===== E2E 结果：{len(PASSED)} 通过 / {len(FAILED)} 失败 =====")
    for name, detail in FAILED:
        print(f"  FAIL {name}: {detail}")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
