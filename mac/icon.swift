// Renders public/logo.svg into mac/Phlox.icns. Run from the ember folder: swift mac/icon.swift
import Cocoa

let fm = FileManager.default
guard let logo = NSImage(contentsOf: URL(fileURLWithPath: "public/logo.svg")) else { fatalError("cannot read public/logo.svg") }
let set = URL(fileURLWithPath: "build/Phlox.iconset")
try? fm.removeItem(at: set)
try fm.createDirectory(at: set, withIntermediateDirectories: true)

func png(_ px: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: px, height: px)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    logo.draw(in: NSRect(x: 0, y: 0, width: px, height: px), from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}
for base in [16, 32, 128, 256, 512] {
    try png(base).write(to: set.appendingPathComponent("icon_\(base)x\(base).png"))
    try png(base * 2).write(to: set.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
let p = Process()
p.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
p.arguments = ["-c", "icns", set.path, "-o", "mac/Phlox.icns"]
try p.run()
p.waitUntilExit()
print(p.terminationStatus == 0 ? "Wrote mac/Phlox.icns" : "iconutil failed")
