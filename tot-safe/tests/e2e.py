# -*- coding: utf-8 -*-
"""
tests/e2e.py — 托安单 TotSafe 浏览器端到端（playwright + 系统 Chrome，零仓库依赖）
覆盖：建档示例 → 看板红灯（健康证/查验缺口/健康事件/隐患）→ 送托闸四连拦截（未点名/配比/
过期证/健康事件待处置）→ 通知处置与整改销案 → 过闸送托 → 月度小结 → 迎检自证包/当日送托单/
家长信任公示单出证 → 查验缺口解除 → 刷新持久化 → 设置与备份全链路。
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8109"
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
        ok("看板点名健康证红灯（许星野）", "许星野" in body)
        ok("看板点名收托查验缺口（壮壮）", "壮壮" in body)
        ok("看板点名健康事件待闭环（苗苗）", "苗苗" in body)
        ok("看板点名隐患未闭环（消毒）", "隐患未闭环" in body)
        score = page.locator("svg.ring text").evaluate("el => el.textContent")
        ok("体检分低于 100（红灯在案）", score.strip().isdigit() and int(score) < 100, f"score={score}")

        print("== 2. 送托闸四连拦截 ==")
        page.evaluate("location.hash='#/ledger'")
        page.wait_for_selector("text=送托六道闸")
        # 2a. 不点名在岗人员 → 拦截
        click(page, "button[data-action='add-daypass']")
        page.wait_for_selector(".toast:not([hidden])")
        toast = page.inner_text("#toast")
        ok("闸机拦截未点名（⛔+无健康合格证不得上岗）", "⛔" in toast and "未点名" in toast, toast)
        # 2b. 保育只点 2 人 → 配比拦截（在园 15 人需 3 名保育）
        page.select_option("#dp-carers", ["st-2", "st-4"])
        page.select_option("#dp-staff", ["st-1", "st-2", "st-4", "st-6"])
        click(page, "button[data-action='add-daypass']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("闸机拦截配比不足（第 20 条）", "第 20 条" in toast, toast)
        # 2c. 保育 3 人但全员点名含过期健康证（许星野）→ 拦截
        page.select_option("#dp-carers", ["st-2", "st-4", "st-5"])
        page.select_option("#dp-staff", ["st-1", "st-2", "st-3", "st-4", "st-5", "st-6"])
        click(page, "button[data-action='add-daypass']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("闸机拦截过期健康证（许星野·76 号令第 14 条）", "许星野" in toast, toast)
        # 2d. 全绿点名 → 仍被健康事件闸拦截（苗苗待通知处置）
        page.select_option("#dp-staff", ["st-1", "st-2", "st-4", "st-5", "st-6"])
        click(page, "button[data-action='add-daypass']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("闸机拦截待处置健康事件（苗苗）", "苗苗" in toast and "健康事件" in toast, toast)

        print("== 3. 健康事件通知处置 + 隐患整改闭环 ==")
        click(page, "button[data-action='show-notify-he']")
        page.wait_for_selector("#m-action")
        page.fill("#m-action", "已电话通知家长 09:40 接回就医，当日出勤注销")
        click(page, "button[data-action='__confirm__']")
        page.wait_for_timeout(300)
        body = page.inner_text("#view")
        ok("健康事件进入待返园核验", "待返园核验" in body)
        click(page, "button[data-action='show-fix-hazard']")
        page.wait_for_selector("#m-action")
        page.fill("#m-action", "玩具补消毒并复查，暂停区角活动一次")
        click(page, "button[data-action='__confirm__']")
        page.wait_for_selector("button[data-action='show-close-hazard']")
        click(page, "button[data-action='show-close-hazard']")
        page.wait_for_selector("#m-verifier")
        page.fill("#m-verifier", "苏晴禾")
        click(page, "button[data-action='__confirm__']")
        page.wait_for_timeout(300)
        body = page.inner_text("#view")
        ok("隐患闭环（已销案）", "已闭环" in body)

        print("== 4. 过闸送托 ==")
        # 步骤 3 的弹窗确认触发整页重渲染，多选已重置——重新点名再过闸
        page.select_option("#dp-carers", ["st-2", "st-4", "st-5"])
        page.select_option("#dp-staff", ["st-1", "st-2", "st-4", "st-5", "st-6"])
        click(page, "button[data-action='add-daypass']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("过闸送托成功（✅+快照）", "✅" in toast and "快照" in toast, toast)
        today = page.evaluate("new Date().toLocaleDateString('sv-SE')")
        body = page.inner_text("#view")
        ok("送托单入账（今日日期在表）", today in body and "还没有送托单" not in body, f"today={today}")

        print("== 5. 月度小结与出证四通道 ==")
        page.evaluate("location.hash='#/reports'")
        page.wait_for_selector("text=月度小结")
        click(page, "button[data-action='rep-apply']")
        page.wait_for_selector("pre.preview")
        text = page.inner_text("pre.preview")
        ok("月报拦截计数=4", "拦截不合规开园 4 次" in text, text[:200])
        ok("月报含晨午检落卡 3 段", "晨午检落卡 3 段" in text)
        ok("月报含托育服务法在审口径", "托育服务法（草案）" in text)
        ok("月报含 76 号令", "教育部令第 76 号" in text)

        with page.expect_download(timeout=8000) as dl:
            click(page, "button[data-action='inspect-download']")
        html = open(dl.value.path(), encoding="utf-8").read()
        ok("迎检自证包可下载且含关键段", all(k in html for k in ["迎检自证包", "晨曦托育园", "工作人员名册", "师幼配比", "健康事件闭环", "变更备案台账"]))

        with page.expect_download(timeout=8000) as dl2:
            click(page, "button[data-action='daypass-download']")
        html2 = open(dl2.value.path(), encoding="utf-8").read()
        ok("当日送托单可下载且含在岗人员", "当日送托单" in html2 and "六道闸" in html2 and "周暖晴" in html2)

        with page.expect_download(timeout=8000) as dl3:
            click(page, "button[data-action='trust-download']")
        html3 = open(dl3.value.path(), encoding="utf-8").read()
        ok("家长信任公示单可下载且脱敏", "家长信任公示" in html3 and "健康证在期" in html3 and "壮壮" not in html3)

        print("== 6. 刷新持久化 ==")
        page.reload()
        page.wait_for_selector("text=账本体检")
        ok("刷新后仍见体检看板", "账本体检" in page.inner_text("#view"))
        page.evaluate("location.hash='#/ledger'")
        page.wait_for_selector("text=送托六道闸")
        ok("刷新后送托单仍在", "送托单" in page.inner_text("#view"))

        print("== 7. 建档页：查验缺口解除与证照钟 ==")
        page.evaluate("location.hash='#/station'")
        page.wait_for_selector("text=机构建档与备案证照钟")
        body = page.inner_text("#view")
        ok("建档页含消防年度证明钟", "消防安全检查合格证明" in body and "WS/T 821 4.1.4" in body)
        ok("查验缺口在册（壮壮）", "壮壮" in body)
        # 解除壮壮接种证缺口
        row = page.locator("tr", has_text="壮壮").first
        row.locator("button[data-action='kid-vaccine']").evaluate("el => el.click()")
        page.wait_for_timeout(300)
        page.evaluate("location.hash='#/board'")
        page.wait_for_timeout(200)
        ok("接种查验后看板缺口红灯解除", "收托查验缺口" not in page.inner_text("#view"))

        print("== 8. 设置与备份 ==")
        page.evaluate("location.hash='#/settings'")
        page.wait_for_selector("text=参数（属地卫健部门要求永远赢）")
        ok("合规雷达含托育服务法", "托育服务法（草案）" in page.inner_text("#view"))
        page.fill("#set-health", "60")
        click(page, "button[data-action='save-settings']")
        page.wait_for_timeout(300)
        ok("参数保存有反馈", "参数已保存" in page.inner_text("#toast"))
        with page.expect_download(timeout=8000) as dl4:
            click(page, "button[data-action='export-json']")
        ok("备份 JSON 可导出", open(dl4.value.path(), encoding="utf-8").read().startswith("{"))

        print("== 9. 页面零错误 ==")
        ok("全程无未捕获页面错误", len(errors) == 0, "; ".join(errors[:3]))

        browser.close()

    print(f"\n===== E2E 结果：{len(PASSED)} 通过 / {len(FAILED)} 失败 =====")
    for name, detail in FAILED:
        print(f"  FAIL {name}: {detail}")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
