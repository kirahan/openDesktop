#!/usr/bin/env swift
import ApplicationServices
import Foundation

struct TreeNode: Codable {
    let role: String
    let title: String?
    let value: String?
    var children: [TreeNode]?
}

struct OkPayload: Codable {
    let ok: Bool
    let truncated: Bool
    let root: TreeNode
}

struct ErrPayload: Codable {
    let ok: Bool
    let truncated: Bool
    let root: TreeNode?
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

guard CommandLine.arguments.count >= 4 else {
    let err = ErrPayload(ok: false, truncated: false, root: nil, code: "BAD_ARGS", message: "usage: axTreeDump.swift <pid> <maxDepth> <maxNodes>")
    let data = try! JSONEncoder().encode(err)
    FileHandle.standardOutput.write(data)
    exit(2)
}

let pid = pid_t(Int32(CommandLine.arguments[1])!)
let maxDepth = Int(CommandLine.arguments[2])!
let maxNodes = Int(CommandLine.arguments[3])!

let appEl = AXUIElementCreateApplication(pid)
var testRef: CFTypeRef?
let tr = AXUIElementCopyAttributeValue(appEl, kAXRoleAttribute as CFString, &testRef)
if tr == AXError.apiDisabled {
    let err = ErrPayload(
        ok: false,
        truncated: false,
        root: nil,
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
        root: nil,
        code: "AX_ERROR",
        message: "AXUIElementCopyAttributeValue failed: \(axErrName(tr)) (\(tr.rawValue))"
    )
    let data = try! JSONEncoder().encode(err)
    FileHandle.standardOutput.write(data)
    exit(0)
}

globalNodeCount = 0
globalTruncated = false
guard let root = buildTree(el: appEl, depth: 0, maxDepth: maxDepth, maxNodes: maxNodes) else {
    let err = ErrPayload(ok: false, truncated: globalTruncated, root: nil, code: "EMPTY_TREE", message: "No nodes enumerated")
    let data = try! JSONEncoder().encode(err)
    FileHandle.standardOutput.write(data)
    exit(0)
}

let ok = OkPayload(ok: true, truncated: globalTruncated, root: root)
let data = try! JSONEncoder().encode(ok)
FileHandle.standardOutput.write(data)
exit(0)
