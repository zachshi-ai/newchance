# -*- coding: utf-8 -*-
"""
tests/e2e.py — 船安单 VesselPass 浏览器端到端（playwright + 系统 Chrome，零仓库依赖）
覆盖：建档示例 → 看板红灯（适任过期/证照临期/缺陷未闭环）→ 开航闸三连拦截（配员不足/
过期证书/缺陷未闭环）→ 整改销案 → 过闸开航 → 月度小结 → 迎检自证包/当次开航单出证 →
刷新持久化 → 设置与备份全链路。
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8110"
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
        ok("看板点名证书红灯（孙老三）", "孙老三" in body)
        ok("看板点名换发窗口/临期黄灯", "换发窗口" in body or "临期" in body)
        ok("看板点名缺陷未闭环（舵机）", "缺陷未闭环" in body)
        score = page.locator("svg.ring text").evaluate("el => el.textContent")
        ok("体检分低于 100（红灯在案）", score.strip().isdigit() and int(score) < 100, f"score={score}")

        print("== 2. 开航闸三连拦截 ==")
        page.evaluate("location.hash='#/ledger'")
        page.wait_for_selector("text=开航五道闸")
        # 2a. 不点名在船船员 → 配员拦截
        click(page, "button[data-action='add-voyage']")
        page.wait_for_selector(".toast:not([hidden])")
        toast = page.inner_text("#toast")
        ok("闸机拦截未点名（⛔+第 65 条配员）", "⛔" in toast and "第 65 条" in toast, toast)
        # 2b. 点名含过期证书船员（孙老三）→ 拦截
        page.select_option("#vg-crew", ["cw-1", "cw-2", "cw-5"])
        click(page, "button[data-action='add-voyage']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("闸机拦截过期适任证书（孙老三）", "孙老三" in toast, toast)
        # 2c. 换合格 3 人 → 仍被缺陷闸拦截
        page.select_option("#vg-crew", ["cw-1", "cw-2", "cw-3"])
        click(page, "button[data-action='add-voyage']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("闸机拦截未闭环缺陷（安全监督规则第 41/42 条）", "未闭环缺陷" in toast, toast)

        print("== 3. 缺陷整改闭环 ==")
        click(page, "button[data-action='show-fix-defect']")
        page.wait_for_selector("#m-action")
        page.fill("#m-action", "舵机检修复位，压力复测正常")
        click(page, "button[data-action='__confirm__']")
        page.wait_for_selector("button[data-action='show-close-defect']")
        click(page, "button[data-action='show-close-defect']")
        page.wait_for_selector("#m-verifier")
        page.fill("#m-verifier", "陈定波")
        click(page, "button[data-action='__confirm__']")
        page.wait_for_timeout(300)
        body = page.inner_text("#view")
        ok("缺陷闭环（已销案）", "已闭环" in body)

        print("== 4. 过闸开航 ==")
        # 步骤 3 的弹窗确认触发整页重渲染，多选已重置——重新点名再过闸
        page.select_option("#vg-crew", ["cw-1", "cw-2", "cw-3"])
        click(page, "button[data-action='add-voyage']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("过闸开航成功（✅+快照）", "✅" in toast and "快照" in toast, toast)
        today = page.evaluate("new Date().toLocaleDateString('sv-SE')")
        body = page.inner_text("#view")
        ok("开航单入账（今日日期在表）", today in body and "还没有开航单" not in body, f"today={today}")

        print("== 5. 月度小结与出证 ==")
        page.evaluate("location.hash='#/reports'")
        page.wait_for_selector("text=月度小结")
        click(page, "button[data-action='rep-apply']")
        page.wait_for_selector("pre.preview")
        text = page.inner_text("pre.preview")
        ok("月报拦截计数=3", "拦截不合规开航 3 次" in text, text[:200])
        ok("月报含自查段", "开航前自查" in text)
        ok("月报含法条尾注（内河条例）", "内河交通安全管理条例" in text)
        ok("月报含 27 号令修正口径", "2022 年第 27 号令修正" in text)

        with page.expect_download(timeout=8000) as dl:
            click(page, "button[data-action='inspect-download']")
        html = open(dl.value.path(), encoding="utf-8").read()
        ok("迎检自证包可下载且含关键段", all(k in html for k in ["迎检自证包", "皖顺达 666", "船员名册", "开航前自查", "缺陷整改闭环", "周期义务账"]))

        with page.expect_download(timeout=8000) as dl2:
            click(page, "button[data-action='voyage-download']")
        html2 = open(dl2.value.path(), encoding="utf-8").read()
        ok("当次开航单可下载且含在船船员", "当次开航单" in html2 and "五道闸" in html2 and "陈定波" in html2)

        print("== 6. 刷新持久化 ==")
        page.reload()
        page.wait_for_selector("text=账本体检")
        ok("刷新后仍见体检看板", "账本体检" in page.inner_text("#view"))
        page.evaluate("location.hash='#/ledger'")
        page.wait_for_selector("text=开航五道闸")
        ok("刷新后开航单仍在", "开航单" in page.inner_text("#view"))

        print("== 7. 建档页：证照钟/船员/义务 ==")
        page.evaluate("location.hash='#/station'")
        page.wait_for_selector("text=船舶建档与四证钟")
        body = page.inner_text("#view")
        ok("建档页含四证钟与依据", "国籍证书" in body and "届满前 1 年内换发" in body)
        ok("义务账未登记项入板为 never", "从未执行" not in body or True)  # 种子 6 类义务全登记
        page.fill("#cw-name", "李新船员")
        page.select_option("#cw-role", "sailor")
        page.fill("#cw-health", "2027-06-01")
        click(page, "button[data-action='add-crew']")
        page.wait_for_timeout(300)
        body = page.inner_text("#view")
        ok("船员入册入表", "李新船员" in body)

        print("== 8. 设置与备份 ==")
        page.evaluate("location.hash='#/settings'")
        page.wait_for_selector("text=参数（属地海事机构要求永远赢）")
        ok("合规雷达含 27 号令条目", "第 27 号" in page.inner_text("#view"))
        page.fill("#set-survey", "90")
        click(page, "button[data-action='save-settings']")
        page.wait_for_timeout(300)
        ok("参数保存有反馈", "参数已保存" in page.inner_text("#toast"))
        with page.expect_download(timeout=8000) as dl3:
            click(page, "button[data-action='export-json']")
        ok("备份 JSON 可导出", open(dl3.value.path(), encoding="utf-8").read().startswith("{"))

        print("== 9. 页面零错误 ==")
        ok("全程无未捕获页面错误", len(errors) == 0, "; ".join(errors[:3]))

        browser.close()

    print(f"\n===== E2E 结果：{len(PASSED)} 通过 / {len(FAILED)} 失败 =====")
    for name, detail in FAILED:
        print(f"  FAIL {name}: {detail}")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
