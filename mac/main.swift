// Phlox.app: a small native window around the local Phlox server.
// It starts `node server.js` from the app's Resources, waits for it, and shows it in a web view.
import Cocoa
import WebKit

let port = 4317
let home = URL(string: "http://127.0.0.1:\(port)/")!

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var server: Process?

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        web.uiDelegate = self
        web.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 780),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Phlox"
        window.appearance = NSAppearance(named: .darkAqua)
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(red: 0.063, green: 0.063, blue: 0.067, alpha: 1)
        web.setValue(false, forKey: "drawsBackground") // no white flash before the page paints
        window.minSize = NSSize(width: 520, height: 420)
        window.contentView = web
        window.setFrameAutosaveName("PhloxMain")
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        if reachable() {
            web.load(URLRequest(url: home))
        } else if let problem = startServer() {
            show(problem)
        } else {
            waitThenLoad(triesLeft: 50)
        }
    }

    // Returns a message when the server could not be started.
    func startServer() -> String? {
        let candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        guard let node = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            return "Phlox needs Node.js. Install it with: brew install node"
        }
        guard let script = Bundle.main.path(forResource: "server", ofType: "js", inDirectory: "app") else {
            return "The app bundle is missing its server files. Rebuild it with mac/build.sh."
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = [script]
        p.currentDirectoryURL = URL(fileURLWithPath: script).deletingLastPathComponent()
        var env = ProcessInfo.processInfo.environment
        env["EMBER_PORT"] = String(port)
        p.environment = env
        do { try p.run() } catch { return "Could not start the Phlox server: \(error.localizedDescription)" }
        server = p
        return nil
    }

    func reachable() -> Bool {
        var req = URLRequest(url: home.appendingPathComponent("api/settings"))
        req.timeoutInterval = 0.4
        let done = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            ok = (resp as? HTTPURLResponse)?.statusCode == 200
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 0.6)
        return ok
    }

    func waitThenLoad(triesLeft: Int) {
        DispatchQueue.global().async {
            let up = self.reachable()
            DispatchQueue.main.async {
                if up { self.web.load(URLRequest(url: home)) }
                else if triesLeft > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.waitThenLoad(triesLeft: triesLeft - 1) } }
                else { self.show("The Phlox server did not start. Run `node server.js` in the ember folder to see why.") }
            }
        }
    }

    func show(_ message: String) {
        let safe = message.replacingOccurrences(of: "<", with: "&lt;")
        web.loadHTMLString("<body style='font:16px -apple-system;padding:60px;color:#b3b3b9;background:#101011'><h2>Phlox could not open</h2><p>\(safe)</p></body>", baseURL: nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ note: Notification) { server?.terminate() }

    // Links that leave Phlox open in the default browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, let host = url.host, host != "127.0.0.1", host != "localhost",
           action.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    // window.prompt, used for naming a new note.
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "Create")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        completionHandler(alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }
    // window.confirm, used before throwing away unsaved edits.
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "Discard")
        alert.addButton(withTitle: "Keep editing")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Phlox", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Phlox", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Phlox", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)

        let viewItem = NSMenuItem()
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        viewItem.submenu = view
        main.addItem(viewItem)
        NSApp.mainMenu = main
    }
    @objc func reload() { web.reload() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
