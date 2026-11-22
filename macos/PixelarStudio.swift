import AppKit
import WebKit
import UniformTypeIdentifiers

@MainActor
final class PixelarAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var pageReady = false
    private var pendingOpenURLs: [URL] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        setupMenuBar()
        setupWindow()
        loadStudioHTML()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        if pageReady {
            for url in urls { sendFileToWeb(url) }
        } else {
            pendingOpenURLs.append(contentsOf: urls)
        }
    }

    private func setupWindow() {
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let w = min(1480.0, screenFrame.width * 0.92)
        let h = min(940.0, screenFrame.height * 0.90)
        let rect = NSRect(
            x: screenFrame.midX - w / 2,
            y: screenFrame.midY - h / 2,
            width: w,
            height: h
        )

        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Pixelar Studio"
        window.minSize = NSSize(width: 960, height: 640)
        window.backgroundColor = NSColor(red: 0.067, green: 0.067, blue: 0.078, alpha: 1.0)
        window.titlebarAppearsTransparent = false
        window.appearance = NSAppearance(named: .darkAqua)
        window.collectionBehavior = [.fullScreenPrimary]
        window.setFrameAutosaveName("PixelarStudioMainWindow")
        window.delegate = self

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let ucc = WKUserContentController()
        ucc.add(self, name: "pixelarSave")
        config.userContentController = ucc

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }

        window.contentView?.addSubview(webView)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func loadStudioHTML() {
        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            let html = "<body style='background:#09090b;color:#ffb000;font-family:-apple-system;padding:40px'><h2>Pixelar Studio</h2><p>Arquivo index.html não encontrado nos recursos do app.</p></body>"
            webView.loadHTMLString(html, baseURL: nil)
        }
    }

    // MARK: - WKNavigationDelegate
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        if !pendingOpenURLs.isEmpty {
            let urls = pendingOpenURLs
            pendingOpenURLs.removeAll()
            for url in urls { sendFileToWeb(url) }
        }
    }

    // MARK: - Native File Open Panel (<input type="file">)
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.title = "Abrir Foto, Vídeo ou Receita"
        panel.beginSheetModal(for: window) { resp in
            completionHandler(resp == .OK ? panel.urls : nil)
        }
    }

    // MARK: - Native Alerts / Confirms
    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "Pixelar Studio"
        alert.informativeText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "Pixelar Studio"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancelar")
        alert.beginSheetModal(for: window) { resp in
            completionHandler(resp == .alertFirstButtonReturn)
        }
    }

    // MARK: - Native Save Panel Bridge (window.webkit.messageHandlers.pixelarSave)
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "pixelarSave",
              let body = message.body as? [String: Any],
              let filename = body["filename"] as? String,
              let base64 = body["base64"] as? String,
              let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
            return
        }

        let panel = NSSavePanel()
        panel.nameFieldStringValue = filename
        panel.canCreateDirectories = true
        panel.title = "Salvar Arquivo do Pixelar Studio"
        let ext = (filename as NSString).pathExtension.lowercased()
        if !ext.isEmpty, let utType = UTType(filenameExtension: ext) {
            panel.allowedContentTypes = [utType]
        }

        panel.beginSheetModal(for: window) { [weak self] resp in
            guard resp == .OK, let destURL = panel.url else { return }
            do {
                try data.write(to: destURL, options: .atomic)
                let safeName = destURL.lastPathComponent.replacingOccurrences(of: "'", with: "\\'")
                self?.evalJS("window.PixelarApp && window.PixelarApp.notify('Salvo: \(safeName)')")
            } catch {
                let errMsg = error.localizedDescription.replacingOccurrences(of: "'", with: "\\'")
                self?.evalJS("window.PixelarApp && window.PixelarApp.notify('Erro ao salvar: \(errMsg)')")
            }
        }
    }

    // MARK: - Load File from Finder / Dock into WebView
    private func sendFileToWeb(_ url: URL) {
        guard let data = try? Data(contentsOf: url) else { return }
        let ext = url.pathExtension.lowercased()
        let mime: String
        switch ext {
        case "jpg", "jpeg": mime = "image/jpeg"
        case "png": mime = "image/png"
        case "webp": mime = "image/webp"
        case "gif": mime = "image/gif"
        case "heic": mime = "image/heic"
        case "mp4", "m4v": mime = "video/mp4"
        case "mov": mime = "video/quicktime"
        case "webm": mime = "video/webm"
        case "avi": mime = "video/x-msvideo"
        default: mime = "application/octet-stream"
        }
        let b64 = data.base64EncodedString()
        let nameEsc = url.lastPathComponent
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        evalJS("window.PixelarApp && window.PixelarApp.loadNativeFile('\(nameEsc)', '\(mime)', '\(b64)')")
    }

    private func evalJS(_ js: String) {
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - Native macOS Menu Bar
    private func setupMenuBar() {
        let mainMenu = NSMenu()

        // App Menu
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "Pixelar Studio")
        appMenu.addItem(withTitle: "Sobre o Pixelar Studio", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Ocultar Pixelar Studio", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Ocultar Outros", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Mostrar Tudo", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Sair do Pixelar Studio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        // Arquivo
        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "Arquivo")
        fileMenu.addItem(withTitle: "Abrir Foto ou Vídeo...", action: #selector(cmdOpenMedia), keyEquivalent: "o")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Exportar...", action: #selector(cmdExport), keyEquivalent: "e")
        fileMenu.addItem(withTitle: "Salvar Preset...", action: #selector(cmdSavePreset), keyEquivalent: "s")
        fileMenu.addItem(withTitle: "Exportar Receita (.json)", action: #selector(cmdExportRecipe), keyEquivalent: "")
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        // Editar
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Editar")
        editMenu.addItem(withTitle: "Desfazer", action: #selector(cmdUndo), keyEquivalent: "z")
        let redoItem = editMenu.addItem(withTitle: "Refazer", action: #selector(cmdRedo), keyEquivalent: "z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Recortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Colar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Selecionar Tudo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Auto Luz", action: #selector(cmdAutoTone), keyEquivalent: "l")
        let resetItem = editMenu.addItem(withTitle: "Restaurar Tudo", action: #selector(cmdResetAll), keyEquivalent: "r")
        resetItem.keyEquivalentModifierMask = [.command, .option]
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        // Visualizar
        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "Visualizar")
        viewMenu.addItem(withTitle: "Foto Única", action: #selector(cmdViewSingle), keyEquivalent: "1")
        viewMenu.addItem(withTitle: "Cortina Antes / Depois", action: #selector(cmdViewSplit), keyEquivalent: "2")
        viewMenu.addItem(withTitle: "Lado a Lado", action: #selector(cmdViewSide), keyEquivalent: "3")
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "Modo Foco", action: #selector(cmdFocus), keyEquivalent: "f")
        viewMenu.addItem(withTitle: "Mostrar / Ocultar Barra de Fotos", action: #selector(cmdStrip), keyEquivalent: "g")
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "Aumentar Zoom", action: #selector(cmdZoomIn), keyEquivalent: "+")
        viewMenu.addItem(withTitle: "Diminuir Zoom", action: #selector(cmdZoomOut), keyEquivalent: "-")
        viewMenu.addItem(withTitle: "Ajustar na Tela", action: #selector(cmdZoomFit), keyEquivalent: "0")
        viewMenu.addItem(.separator())
        let fsItem = viewMenu.addItem(withTitle: "Alternar Tela Cheia", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fsItem.keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = viewMenu
        mainMenu.addItem(viewItem)

        // Ferramentas
        let toolsItem = NSMenuItem()
        let toolsMenu = NSMenu(title: "Ferramentas")
        let addTool: (String, Selector, String) -> Void = { title, sel, key in
            let it = toolsMenu.addItem(withTitle: title, action: sel, keyEquivalent: key)
            it.keyEquivalentModifierMask = [.option]
        }
        addTool("Filmes & Câmeras", #selector(cmdTabPresets), "1")
        addTool("Luz & Curva", #selector(cmdTabLight), "2")
        addTool("Cor, HSL & Grading", #selector(cmdTabColor), "3")
        addTool("Óptica & Química", #selector(cmdTabOptics), "4")
        addTool("Laboratório Criativo", #selector(cmdTabLab), "5")
        addTool("Geometria & Corte", #selector(cmdTabCrop), "6")
        toolsItem.submenu = toolsMenu
        mainMenu.addItem(toolsItem)

        // Janela
        let winItem = NSMenuItem()
        let winMenu = NSMenu(title: "Janela")
        winMenu.addItem(withTitle: "Minimizar", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winItem.submenu = winMenu
        mainMenu.addItem(winItem)

        NSApp.mainMenu = mainMenu
        NSApp.windowsMenu = winMenu
    }

    @objc private func showAbout() {
        let alert = NSAlert()
        alert.messageText = "Pixelar Studio 2.0"
        alert.informativeText = "Laboratório Fotográfico & Vídeo Analógico nativo para macOS.\nFilmes clássicos, vencidos, câmeras cult, Sony Cyber-shot AVI, Laboratório Criativo Dinâmico e Geometria estilo Lightroom."
        alert.runModal()
    }
    @objc private func cmdOpenMedia() { evalJS("window.PixelarApp && window.PixelarApp.openMedia()") }
    @objc private func cmdExport() { evalJS("window.PixelarApp && window.PixelarApp.openExport()") }
    @objc private func cmdSavePreset() { evalJS("window.PixelarApp && window.PixelarApp.openSavePreset()") }
    @objc private func cmdExportRecipe() { evalJS("window.PixelarApp && window.PixelarApp.exportRecipeJson()") }
    @objc private func cmdUndo() { evalJS("window.PixelarApp && window.PixelarApp.undo()") }
    @objc private func cmdRedo() { evalJS("window.PixelarApp && window.PixelarApp.redo()") }
    @objc private func cmdAutoTone() { evalJS("window.PixelarApp && window.PixelarApp.autoTone()") }
    @objc private func cmdResetAll() { evalJS("window.PixelarApp && window.PixelarApp.resetAll()") }
    @objc private func cmdViewSingle() { evalJS("window.PixelarApp && window.PixelarApp.setViewMode('single')") }
    @objc private func cmdViewSplit() { evalJS("window.PixelarApp && window.PixelarApp.setViewMode('split')") }
    @objc private func cmdViewSide() { evalJS("window.PixelarApp && window.PixelarApp.setViewMode('side')") }
    @objc private func cmdFocus() { evalJS("window.PixelarApp && window.PixelarApp.toggleFocus()") }
    @objc private func cmdStrip() { evalJS("window.PixelarApp && window.PixelarApp.toggleStrip()") }
    @objc private func cmdZoomIn() { evalJS("window.PixelarApp && window.PixelarApp.zoomIn()") }
    @objc private func cmdZoomOut() { evalJS("window.PixelarApp && window.PixelarApp.zoomOut()") }
    @objc private func cmdZoomFit() { evalJS("window.PixelarApp && window.PixelarApp.zoomFit()") }
    @objc private func cmdTabPresets() { evalJS("window.PixelarApp && window.PixelarApp.selectTab('presets')") }
    @objc private func cmdTabLight() { evalJS("window.PixelarApp && window.PixelarApp.selectTab('light')") }
    @objc private func cmdTabColor() { evalJS("window.PixelarApp && window.PixelarApp.selectTab('color')") }
    @objc private func cmdTabOptics() { evalJS("window.PixelarApp && window.PixelarApp.selectTab('optics')") }
    @objc private func cmdTabLab() { evalJS("window.PixelarApp && window.PixelarApp.selectTab('lab')") }
    @objc private func cmdTabCrop() { evalJS("window.PixelarApp && window.PixelarApp.selectTab('crop')") }
}

@main
enum PixelarStudioMain {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let delegate = PixelarAppDelegate()
        app.delegate = delegate
        app.run()
    }
}
