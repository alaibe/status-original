import ExpoModulesCore
import WebKit

public class WebCookiesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WebCookies")

    AsyncFunction("get") { (domains: [String], promise: Promise) in
      DispatchQueue.main.async {
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
          promise.resolve(
            cookies
              .filter { cookie in domains.contains { matches(cookie.domain, $0) } }
              .map { ["name": $0.name, "value": $0.value, "domain": $0.domain] }
          )
        }
      }
    }

    AsyncFunction("clear") { (domains: [String], promise: Promise) in
      DispatchQueue.main.async {
        let store = WKWebsiteDataStore.default().httpCookieStore
        store.getAllCookies { cookies in
          let doomed = cookies.filter { cookie in domains.contains { matches(cookie.domain, $0) } }
          let group = DispatchGroup()
          for cookie in doomed {
            group.enter()
            store.delete(cookie) { group.leave() }
          }
          group.notify(queue: .main) { promise.resolve(nil) }
        }
      }
    }
  }
}

private func matches(_ cookieDomain: String, _ wanted: String) -> Bool {
  let host = cookieDomain.hasPrefix(".") ? String(cookieDomain.dropFirst()) : cookieDomain
  return host == wanted || host.hasSuffix("." + wanted) || wanted.hasSuffix("." + host)
}
