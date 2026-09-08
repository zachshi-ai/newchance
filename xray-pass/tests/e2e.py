# -*- coding: utf-8 -*-
"""
tests/e2e.py — 拍片单 XrayPass 浏览器端到端（playwright + 系统 Chrome，零仓库依赖）
覆盖：建档示例 → 看板红灯 → 拍片闸三连拦截（培训剂量超期/状态检测超期/妊娠未问/怀孕）→
问明未孕放行 → 快捷登记培训剂量 → 复拍放行 → 月报拦截计数 → 自证包/核对单出证 → 刷新持久化。
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8112"
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
        ok("双证续期窗口黄灯（剩 20 天）", "剩20天" in body)
        ok("看板点名状态检测红灯", "状态检测红灯" in body)
        ok("看板点名人员红灯（李知行）", "李知行" in body)
        score = page.locator("svg.ring text").evaluate("el => el.textContent")
        ok("体检分低于 100（红灯在案）", score.strip().isdigit() and int(score) < 100, f"score={score}")

        print("== 2. 拍片闸三连拦截 ==")
        page.evaluate("location.hash='#/ledger'")
        page.wait_for_selector("text=拍片六道闸")
        # 2a. 超期人员（培训+剂量）→ 拦截
        page.select_option("#sh-worker", "wk-2")
        page.select_option("#sh-device", "dv-1")
        click(page, "button[data-action='add-shot']")
        page.wait_for_selector(".toast:not([hidden])")
        toast = page.inner_text("#toast")
        ok("闸机拦截超期人员（⛔+90 天上限）", "⛔" in toast and ("90 天" in toast or "第 28 条" in toast), toast)
        # 2b. 换合格人员 + 检测超期设备 → 拦截
        page.select_option("#sh-worker", "wk-1")
        page.select_option("#sh-device", "dv-2")
        click(page, "button[data-action='add-shot']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("闸机拦截检测超期设备（46 号令第 20/41 条）", "口腔 CT" in toast and ("第 41 条(三)" in toast or "超期" in toast), toast)
        # 2c. 合格人员+合格设备+育龄妇女未问妊娠 → 拦截
        page.select_option("#sh-device", "dv-1")
        page.select_option("#sh-ptype", "woman")
        click(page, "button[data-action='add-shot']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("闸机拦截妊娠未问（46 号令第 26 条(三)）", "第 26 条(三)" in toast, toast)
        # 2d. 已怀孕且非特殊需要 → 拦截
        page.select_option("#sh-preg", "pregnant")
        click(page, "button[data-action='add-shot']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("闸机拦截已怀孕非特殊需要", "已怀孕" in toast, toast)

        print("== 3. 问明未孕 → 过闸落账 ==")
        page.select_option("#sh-preg", "not-pregnant")
        page.fill("#sh-bodypart", "24 根尖片")
        click(page, "button[data-action='add-shot']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("过闸拍片成功（✅+快照）", "✅" in toast and "快照" in toast, toast)
        today = page.evaluate("new Date().toLocaleDateString('sv-SE')")
        body = page.inner_text("#view")
        ok("拍片台账入账（今日在表）", today in body and "还没有拍片落账" not in body, f"today={today}")

        print("== 4. 快捷登记超期人员 → 复拍放行 ==")
        click(page, "button[data-action='quick-fix']")
        page.wait_for_selector("#m-training")
        page.fill("#m-training", today)
        page.fill("#m-dose", today)
        click(page, "button[data-action='__confirm__']")
        page.wait_for_timeout(300)
        page.select_option("#sh-worker", "wk-2")
        page.select_option("#sh-ptype", "adult")
        click(page, "button[data-action='add-shot']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("培训剂量补登后复拍放行", "✅" in toast, toast)

        print("== 5. 月度小结与出证 ==")
        page.evaluate("location.hash='#/reports'")
        page.wait_for_selector("text=月度小结")
        click(page, "button[data-action='rep-apply']")
        page.wait_for_selector("pre.preview")
        text = page.inner_text("pre.preview")
        ok("月报拦截计数=4", "拦截不合规拍片 4 次" in text, text[:160])
        ok("月报落账计数=3（含昨日种子片）", "落账拍片 3 笔" in text, text[:200])
        ok("月报含法条尾注（449/46/55 号）", "449 号令" in text and "46 号令" in text and "55 号令" in text)

        with page.expect_download(timeout=8000) as dl:
            click(page, "button[data-action='inspect-download']")
        html = open(dl.value.path(), encoding="utf-8").read()
        ok("迎检自证包可下载且含关键段", all(k in html for k in ["迎检自证包", "明澈口腔门诊部", "射线装置一机一档", "放射工作人员名册", "拍片台账", "变更/重新申领台账"]))

        with page.expect_download(timeout=8000) as dl2:
            click(page, "button[data-action='shot-download']")
        html2 = open(dl2.value.path(), encoding="utf-8").read()
        ok("拍片核对单可下载且含妊娠询问与快照", "拍片合规核对单" in html2 and "妊娠询问" in html2 and "设备状态检测有效期" in html2)

        print("== 6. 刷新持久化 ==")
        page.reload()
        page.wait_for_selector("text=账本体检")
        page.evaluate("location.hash='#/ledger'")
        page.wait_for_selector("text=拍片六道闸")
        body = page.inner_text("#view")
        ok("刷新后拍片台账仍在", "核对单" in body and "还没有拍片落账" not in body)

        print("== 7. 建档页：双证按钮/设备/义务 ==")
        page.evaluate("location.hash='#/station'")
        page.wait_for_selector("text=机构建档与双证钟")
        body = page.inner_text("#view")
        ok("建档页含双证延续按钮", "辐射安全证延续办结" in body and "放射诊疗证校验办结" in body)
        ok("义务账点名年度评估逾期", "已逾期" in body and "年度评估" in body)
        page.fill("#wk-name", "测试新人")
        click(page, "button[data-action='add-worker']")
        page.wait_for_timeout(300)
        ok("人员入册入表", "测试新人" in page.inner_text("#view"))

        print("== 8. 设置与备份 ==")
        page.evaluate("location.hash='#/settings'")
        page.wait_for_selector("text=参数（属地生态环境与卫生部门要求永远赢）")
        page.fill("#set-renew", "45")
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
