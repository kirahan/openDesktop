#!/usr/bin/env swift
import ApplicationServices
import Foundation

struct TreeNode: Codable {
    let role: String
    let title: String?
    let value: String?
    var children: [TreeNode]?
}

struct AtPointOk: Codable {
    let ok: Bool
    let truncated: Bool
    let screenX: Double
    let screenY: Double
    let ancestors: [TreeNode]
    let at: TreeNode
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

let ok = AtPointOk(
    ok: true,
    truncated: globalTruncated,
    screenX: screenX,
    screenY: screenY,
    ancestors: ancestors,
    at: atRoot
)
let data = try! JSONEncoder().encode(ok)
FileHandle.standardOutput.write(data)
exit(0)
