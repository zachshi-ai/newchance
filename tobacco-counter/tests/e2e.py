# -*- coding: utf-8 -*-
"""
tests/e2e.py — 烟柜账 CounterBook 浏览器端到端（playwright + 系统 Chrome，零仓库依赖）
覆盖：建档示例 → 看板红灯 → 售烟四闸三连拦截（疑似未成年未核验/核验后未成年/许可证过期）→
核验放行落账 → 开柜检查异常转事件 → 处置闭环 → 建档拦截调味电子烟 → 进货落账 →
月度小结 → 迎检自证包/柜台核对单出证 → 刷新持久化 → 设置与备份全链路。
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8111"
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
        page.evaluate("localStorage.clear()")
        page.reload()
        page.wait_for_selector("text=先看示例数据")
        ok("冷启动出现引导页", page.locator("text=为什么需要它").count() > 0)
        click(page, "button[data-action='seed-demo']")
        page.wait_for_selector("text=账本体检")
        body = page.inner_text("#view")
        ok("示例建档成功（hero 出现）", "账本体检" in body)
        ok("许可证在期绿灯（至 255 天后）", "在期" in body)
        ok("看板点名变更手续未办结", "变更手续未办结" in body)
        ok("看板点名周期义务欠账（库存月查逾期）", "周期义务欠账" in body)
        score = page.locator("svg.ring text").evaluate("el => el.textContent")
        ok("体检分低于 100（红灯在案）", score.strip().isdigit() and int(score) < 100, f"score={score}")

        print("== 2. 售烟四闸三连拦截 ==")
        page.evaluate("location.hash='#/ledger'")
        page.wait_for_selector("text=售烟四闸")
        # 2a. 疑似未成年未核验 → 拦截
        page.check("#sl-minor")
        click(page, "button[data-action='add-sale']")
        page.wait_for_selector(".toast:not([hidden])")
        toast = page.inner_text("#toast")
        ok("拦截疑似未成年未核验（⛔+出示身份证件）", "⛔" in toast and "出示身份证件" in toast, toast)
        # 2b. 核验后仍未满 18 → 硬拒
        page.check("#sl-verified")
        page.fill("#sl-dob", "2008-09-10")
        click(page, "button[data-action='add-sale']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("拦截核验后未成年（⛔+第 123 条）", "⛔" in toast and "第 123 条" in toast, toast)
        # 2c. 恢复正常（取消未成年标记）→ 放行
        page.uncheck("#sl-minor")
        page.uncheck("#sl-verified")
        page.fill("#sl-dob", "")
        click(page, "button[data-action='add-sale']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("过闸售烟成功（✅+快照）", "✅" in toast and "快照" in toast, toast)

        print("== 3. 许可证过期 → 闸 1 拦截 → 恢复 ==")
        page.evaluate("location.hash='#/station'")
        page.wait_for_selector("text=店铺建档与许可证钟")
        page.fill("#vs-licexpiry", "2026-09-01")
        click(page, "button[data-action='save-shop']")
        page.wait_for_timeout(300)
        page.evaluate("location.hash='#/ledger'")
        page.wait_for_selector("text=售烟四闸")
        click(page, "button[data-action='add-sale']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("拦截过期许可证售烟（⛔+第 57 条）", "⛔" in toast and "第 57 条" in toast, toast)
        page.evaluate("location.hash='#/station'")
        page.wait_for_selector("text=店铺建档与许可证钟")
        page.fill("#vs-licexpiry", "2027-05-20")
        click(page, "button[data-action='save-shop']")
        page.wait_for_timeout(300)
        page.evaluate("location.hash='#/ledger'")
        page.wait_for_selector("text=售烟四闸")
        click(page, "button[data-action='add-sale']")
        page.wait_for_timeout(300)
        ok("许可证恢复后放行", "✅" in page.inner_text("#toast"))

        print("== 4. 开柜检查异常 → 自动转事件 → 处置闭环 ==")
        page.check("#dc-vending")
        page.check("#dc-online")
        page.check("#dc-vapeFlavor")
        page.check("#dc-vapePlatform")
        page.fill("#dcnote-signage", "标志一角翘边，已重新张贴平整")
        click(page, "button[data-action='add-daycheck']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("检查卡落卡并自动转事件", "自动转合规事件" in toast, toast)
        click(page, "button[data-action='show-fix-event']")
        page.fill("#m-action", "重新张贴「不向未成年人售烟」标志并加固四角")
        click(page, "button[data-action='__confirm__']")
        page.wait_for_selector("button[data-action='show-close-event']")
        click(page, "button[data-action='show-close-event']")
        page.wait_for_selector("#m-verifier")
        page.fill("#m-verifier", "顾金叶")
        click(page, "button[data-action='__confirm__']")
        page.wait_for_timeout(300)
        ok("事件闭环（已销案）", "已闭环" in page.inner_text("#view"))

        print("== 5. 建档拦截调味电子烟（电子烟办法第 26 条） ==")
        page.evaluate("location.hash='#/station'")
        page.wait_for_selector("text=品规一物一档")
        page.fill("#pd-name", "薄荷味烟弹（拒绝示例）")
        page.select_option("#pd-kind", "vape")
        page.select_option("#pd-flavor", "other")
        page.fill("#pd-code", "VP-MINT-01")
        click(page, "button[data-action='add-product']")
        page.wait_for_timeout(300)
        toast = page.inner_text("#toast")
        ok("调味电子烟建档被拒", "电子烟办法第 26 条" in toast, toast)
        page.fill("#pd-name", "某品牌烟弹·烟草口味（新品）")
        page.select_option("#pd-flavor", "tobacco")
        page.fill("#pd-code", "VP-TB-099")
        click(page, "button[data-action='add-product']")
        page.wait_for_timeout(300)
        ok("烟草味电子烟建档成功", "VP-TB-099" in page.inner_text("#view"))

        print("== 6. 进货落账与红旗隔离 ==")
        page.evaluate("location.hash='#/ledger'")
        page.wait_for_selector("text=进货台账")
        page.select_option("#pu-product", "pd-5")
        page.select_option("#pu-source", "vapePlatform")
        page.fill("#pu-orderno", "PT-2026-0909-6677")
        page.fill("#pu-qty", "5")
        click(page, "button[data-action='add-purchase']")
        page.wait_for_timeout(300)
        ok("平台进货落账", "PT-2026-0909-6677" in page.inner_text("#view"))
        ok("进货落账反馈", "进货已落账" in page.inner_text("#toast"))

        print("== 7. 月度小结与出证 ==")
        page.evaluate("location.hash='#/reports'")
        page.wait_for_selector("text=月度小结")
        click(page, "button[data-action='rep-apply']")
        page.wait_for_selector("pre.preview")
        text = page.inner_text("pre.preview")
        ok("月报拦截计数=3", "拦截不合规售烟 3 次" in text, text[:200])
        ok("月报含未成年人核验细分", "未成年人核验拦截 2 次" in text, text[:300])
        ok("月报含法条尾注（四修条例）", "2023 第四次修订" in text)
        ok("月报含未保法", "《未成年人保护法》" in text)

        with page.expect_download(timeout=8000) as dl:
            click(page, "button[data-action='inspect-download']")
        path = dl.value.path()
        html = open(path, encoding="utf-8").read()
        ok("迎检自证包可下载且含关键段", all(k in html for k in ["迎检自证包", "金叶便利店", "品规台账", "进货台账", "销售台账", "每日开柜检查", "合规事件闭环", "变更手续台账", "周期义务账", "第 46 条"]))

        with page.expect_download(timeout=8000) as dl2:
            click(page, "button[data-action='daypass-download']")
        path2 = dl2.value.path()
        html2 = open(path2, encoding="utf-8").read()
        ok("柜台核对单可下载且含销售与核验", "当日柜台核对单" in html2 and "软中华" in html2 and "不向未成年人售烟" in html2)

        print("== 8. 刷新持久化 ==")
        page.reload()
        page.wait_for_selector("text=账本体检")
        ok("刷新后仍见体检看板", "账本体检" in page.inner_text("#view"))
        page.evaluate("location.hash='#/ledger'")
        page.wait_for_selector("text=售烟四闸")
        ok("刷新后销售台账仍在", "四闸全过" in page.inner_text("#view") or "过闸" in page.inner_text("#view"))

        print("== 9. 建档页：变更/义务/停业 ==")
        page.evaluate("location.hash='#/station'")
        page.wait_for_selector("text=店铺建档与许可证钟")
        body = page.inner_text("#view")
        ok("建档页含延续按钮与窗口提示", "延续办结" in body and "届满 30 日前提出申请" in body)
        ok("义务账在板（含执照年报跨线提醒）", "营业执照年报" in body)
        page.evaluate("location.hash='#/settings'")
        page.wait_for_selector("text=参数（属地烟草专卖局要求永远赢）")
        page.fill("#set-channel", "30")
        click(page, "button[data-action='save-settings']")
        page.wait_for_timeout(300)
        ok("参数保存有反馈", "参数已保存" in page.inner_text("#toast"))

        print("== 10. 备份与页面零错误 ==")
        page.evaluate("location.hash='#/settings'")
        page.wait_for_selector("text=数据（只存本机，换机走备份）")
        with page.expect_download(timeout=8000) as dl3:
            click(page, "button[data-action='export-json']")
        path3 = dl3.value.path()
        ok("备份 JSON 可导出", open(path3, encoding="utf-8").read().startswith("{"))
        ok("全程无未捕获页面错误", len(errors) == 0, "; ".join(errors[:3]))

        browser.close()

    print(f"\n===== E2E 结果：{len(PASSED)} 通过 / {len(FAILED)} 失败 =====")
    for name, detail in FAILED:
        print(f"  FAIL {name}: {detail}")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
