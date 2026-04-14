#!/usr/bin/env swift
import ApplicationServices
import AppKit
import Foundation

struct TreeNode: Codable {
    let role: String
    let title: String?
    let value: String?
    var children: [TreeNode]?
}

/// 与 Electron `screen.getCursorScreenPoint()` / `Display.bounds` 一致的**全局**屏幕坐标（原点左上、y 向下）。
struct HitFrameElectron: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct AtPointOk: Codable {
    let ok: Bool
    let truncated: Bool
    let screenX: Double
    let screenY: Double
    let ancestors: [TreeNode]
    let at: TreeNode
    /// 命中元素 AX frame，转换后与 Electron 屏幕坐标系一致；无法读取时省略。
    let hitFrame: HitFrameElectron?
}

struct ErrPayload: Codable {
    let ok: Bool
    let truncated: Bool
    let code: String
    let message: String
}

func attrString(_ el: AXUIElement, _ name: CFString) -> String? {
    var v: CFTypeRef?
    let r = AXUIElementCopyAttributeValue(el, name, &v)
    guard r == AXError.success, let ref = v else { return nil }
    if let s = ref as? String { return s }
    if let n = ref as? NSNumber { return n.stringValue }
    return nil
}

func axErrName(_ e: AXError) -> String {
    String(describing: e)
}

func hasChildrenHint(_ el: AXUIElement) -> Bool {
    var v: CFTypeRef?
    let r = AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &v)
    guard r == AXError.success, let ref = v else { return false }
    if let a = ref as? [AXUIElement] { return !a.isEmpty }
    if CFGetTypeID(ref) == CFArrayGetTypeID() {
        return CFArrayGetCount(ref as! CFArray) > 0
    }
    return false
}

var globalTruncated = false
var globalNodeCount = 0

func buildTree(el: AXUIElement, depth: Int, maxDepth: Int, maxNodes: Int) -> TreeNode? {
    globalNodeCount += 1
    if globalNodeCount > maxNodes {
        globalTruncated = true
        return nil
    }

    let role = attrString(el, kAXRoleAttribute as CFString) ?? "AXUnknown"
    let title = attrString(el, kAXTitleAttribute as CFString)
    let value = attrString(el, kAXValueAttribute as CFString)

    if depth >= maxDepth {
        if hasChildrenHint(el) { globalTruncated = true }
        return TreeNode(role: role, title: title, value: value, children: nil)
    }

    var childrenRef: CFTypeRef?
    let cr = AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &childrenRef)
    guard cr == AXError.success, childrenRef != nil else {
        return TreeNode(role: role, title: title, value: value, children: nil)
    }

    var childElements: [AXUIElement] = []
    if let arr = childrenRef as? [AXUIElement] {
        childElements = arr
    } else if CFGetTypeID(childrenRef!) == CFArrayGetTypeID() {
        let cfArr = childrenRef as! CFArray
        let n = CFArrayGetCount(cfArr)
        for i in 0..<n {
            let p = CFArrayGetValueAtIndex(cfArr, i)
            childElements.append(Unmanaged<AXUIElement>.fromOpaque(p!).takeUnretainedValue())
        }
    } else {
        return TreeNode(role: role, title: title, value: value, children: nil)
    }

    var childNodes: [TreeNode] = []
    for ch in childElements {
        if globalNodeCount >= maxNodes {
            globalTruncated = true
            break
        }
        if let sub = buildTree(el: ch, depth: depth + 1, maxDepth: maxDepth, maxNodes: maxNodes) {
            childNodes.append(sub)
        } else {
            break
        }
    }

    if !childElements.isEmpty && childNodes.count < childElements.count {
        globalTruncated = true
    }

    return TreeNode(role: role, title: title, value: value, children: childNodes.isEmpty ? nil : childNodes)
}

func shallowNode(_ el: AXUIElement) -> TreeNode {
    let role = attrString(el, kAXRoleAttribute as CFString) ?? "AXUnknown"
    let title = attrString(el, kAXTitleAttribute as CFString)
    let value = attrString(el, kAXValueAttribute as CFString)
    return TreeNode(role: role, title: title, value: value, children: nil)
}

/// `AXFrame` 为 Quartz 全局坐标（原点左下）；部分宿主只暴露 `AXPosition` + `AXSize`。
func axQuartzFrame(_ el: AXUIElement) -> CGRect? {
    var v: CFTypeRef?
    // `kAXFrameAttribute` 在部分 Swift 脚本环境下不可见，使用标准属性名。
    guard AXUIElementCopyAttributeValue(el, "AXFrame" as CFString, &v) == .success, let ref = v else {
        return nil
    }
    var rect = CGRect.zero
    let axVal = ref as! AXValue
    guard AXValueGetValue(axVal, .cgRect, &rect) else { return nil }
    return rect
}

func axQuartzPoint(_ el: AXUIElement) -> CGPoint? {
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, "AXPosition" as CFString, &v) == .success, let ref = v else { return nil }
    var p = CGPoint.zero
    guard AXValueGetValue(ref as! AXValue, .cgPoint, &p) else { return nil }
    return p
}

func axQuartzSize(_ el: AXUIElement) -> CGSize? {
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, "AXSize" as CFString, &v) == .success, let ref = v else { return nil }
    var s = CGSize.zero
    guard AXValueGetValue(ref as! AXValue, .cgSize, &s) else { return nil }
    return s
}

func axQuartzFrameOrCompose(_ el: AXUIElement) -> CGRect? {
    if let r = axQuartzFrame(el), r.width > 0, r.height > 0 {
        return r
    }
    guard let o = axQuartzPoint(el), let s = axQuartzSize(el), s.width > 0, s.height > 0 else { return nil }
    return CGRect(origin: o, size: s)
}

func quartzRectToElectronGlobal(_ r: CGRect) -> HitFrameElectron {
    let screens = NSScreen.screens
    guard !screens.isEmpty else {
        return HitFrameElectron(
            x: Double(r.minX), y: Double(r.minY), width: Double(r.width), height: Double(r.height))
    }
    var vminX = CGFloat.greatestFiniteMagnitude
    var vmaxY = -CGFloat.greatestFiniteMagnitude
    for s in screens {
        let f = s.frame
        vminX = min(vminX, f.minX)
        vmaxY = max(vmaxY, f.maxY)
    }
    let ex = Double(r.minX - vminX)
    let ey = Double(vmaxY - r.maxY)
    return HitFrameElectron(x: ex, y: ey, width: Double(r.width), height: Double(r.height))
}

/// 多种常见坐标解释；用与 `CopyElementAtPosition` 相同的指针 (screenX, screenY) 做包含判定，选出与 Electron 最一致的一种。
func hitFrameElectronCandidates(_ r: CGRect) -> [HitFrameElectron] {
    let screens = NSScreen.screens
    var vminX = CGFloat.greatestFiniteMagnitude
    var vmaxY = -CGFloat.greatestFiniteMagnitude
    for s in screens {
        let f = s.frame
        vminX = min(vminX, f.minX)
        vmaxY = max(vmaxY, f.maxY)
    }
    var list: [HitFrameElectron] = []
    func add(_ h: HitFrameElectron) {
        if !list.contains(where: {
            abs($0.x - h.x) < 0.01 && abs($0.y - h.y) < 0.01 && abs($0.width - h.width) < 0.01
                && abs($0.height - h.height) < 0.01
        }) {
            list.append(h)
        }
    }
    add(quartzRectToElectronGlobal(r))
    add(
        HitFrameElectron(
            x: Double(r.minX), y: Double(vmaxY - r.maxY), width: Double(r.width), height: Double(r.height)))
    add(
        HitFrameElectron(
            x: Double(r.minX - vminX), y: Double(r.minY), width: Double(r.width), height: Double(r.height)))
    add(HitFrameElectron(x: Double(r.minX), y: Double(r.minY), width: Double(r.width), height: Double(r.height)))
    return list
}

func pickHitFrame(from r: CGRect, pointerX: Double, pointerY: Double) -> HitFrameElectron? {
    guard r.width > 0, r.height > 0 else { return nil }
    let cands = hitFrameElectronCandidates(r)
    let margin: Double = 6
    for c in cands {
        if pointerX >= c.x - margin && pointerX <= c.x + c.width + margin && pointerY >= c.y - margin
            && pointerY <= c.y + c.height + margin
        {
            return c
        }
    }
    return cands.first
}

// swift path/to/script.swift <pid> <x> <y> <maxAncestorDepth> <maxLocalDepth> <maxNodes>
// argv[0]=脚本路径，共 7 个元素。
guard CommandLine.arguments.count >= 7 else {
    let err = ErrPayload(
        ok: false,
        truncated: false,
        code: "BAD_ARGS",
        message: "usage: axTreeAtPoint.swift <pid> <x> <y> <maxAncestorDepth> <maxLocalDepth> <maxNodes>"
    )
    let data = try! JSONEncoder().encode(err)
    FileHandle.standardOutput.write(data)
    exit(2)
}

let pid = pid_t(Int32(CommandLine.arguments[1])!)
let screenX = Double(CommandLine.arguments[2])!
let screenY = Double(CommandLine.arguments[3])!
let maxAncestorDepth = Int(CommandLine.arguments[4])!
let maxLocalDepth = Int(CommandLine.arguments[5])!
let maxNodes = Int(CommandLine.arguments[6])!

let appEl = AXUIElementCreateApplication(pid)
var testRef: CFTypeRef?
let tr = AXUIElementCopyAttributeValue(appEl, kAXRoleAttribute as CFString, &testRef)
if tr == AXError.apiDisabled {
    let err = ErrPayload(
        ok: false,
        truncated: false,
        code: "ACCESSIBILITY_DISABLED",
        message:
            "Accessibility API disabled — grant “Accessibility” to the terminal or opd binary in System Settings → Privacy & Security."
    )
    let data = try! JSONEncoder().encode(err)
    FileHandle.standardOutput.write(data)
    exit(0)
}
if tr != AXError.success && tr != AXError.attributeUnsupported {
    let err = ErrPayload(
        ok: false,
        truncated: false,
        code: "AX_ERROR",
        message: "AXUIElementCopyAttributeValue failed: \(axErrName(tr)) (\(tr.rawValue))"
    )
    let data = try! JSONEncoder().encode(err)
    FileHandle.standardOutput.write(data)
    exit(0)
}

var hitEl: AXUIElement?
let hx = Float32(screenX)
let hy = Float32(screenY)
let her = AXUIElementCopyElementAtPosition(appEl, hx, hy, &hitEl)
if her != AXError.success {
    let err = ErrPayload(
        ok: false,
        truncated: false,
        code: "AT_POINT_FAILED",
        message: "AXUIElementCopyElementAtPosition failed: \(axErrName(her)) (\(her.rawValue))"
    )
    let data = try! JSONEncoder().encode(err)
    FileHandle.standardOutput.write(data)
    exit(0)
}
guard let hit = hitEl else {
    let err = ErrPayload(ok: false, truncated: false, code: "NO_HIT", message: "No AX element at screen position")
    let data = try! JSONEncoder().encode(err)
    FileHandle.standardOutput.write(data)
    exit(0)
}

var ancestors: [TreeNode] = []
var walk: AXUIElement? = hit
for _ in 0..<max(0, maxAncestorDepth) {
    var parentRef: CFTypeRef?
    guard let cur = walk else { break }
    let pr = AXUIElementCopyAttributeValue(cur, kAXParentAttribute as CFString, &parentRef)
    guard pr == AXError.success, let pref = parentRef else { break }
    let pel = pref as! AXUIElement
    ancestors.append(shallowNode(pel))
    walk = pel
}

globalNodeCount = 0
globalTruncated = false
guard let atRoot = buildTree(el: hit, depth: 0, maxDepth: maxLocalDepth, maxNodes: maxNodes) else {
    let err = ErrPayload(
        ok: false,
        truncated: globalTruncated,
        code: "EMPTY_SUBTREE",
        message: "Could not build subtree at hit"
    )
    let data = try! JSONEncoder().encode(err)
    FileHandle.standardOutput.write(data)
    exit(0)
}

let hitFrame: HitFrameElectron? = axQuartzFrameOrCompose(hit).flatMap {
    pickHitFrame(from: $0, pointerX: screenX, pointerY: screenY)
}

let ok = AtPointOk(
    ok: true,
    truncated: globalTruncated,
    screenX: screenX,
    screenY: screenY,
    ancestors: ancestors,
    at: atRoot,
    hitFrame: hitFrame
)
let data = try! JSONEncoder().encode(ok)
FileHandle.standardOutput.write(data)
exit(0)
