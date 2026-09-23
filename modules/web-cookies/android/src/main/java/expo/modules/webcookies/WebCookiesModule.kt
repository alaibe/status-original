package expo.modules.webcookies

import android.webkit.CookieManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WebCookiesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WebCookies")

    AsyncFunction("get") { domains: List<String> ->
      val manager = CookieManager.getInstance()
      domains.flatMap { domain ->
        parse(manager.getCookie("https://$domain")).map { (name, value) ->
          mapOf("name" to name, "value" to value, "domain" to domain)
        }
      }
    }

    AsyncFunction("clear") { domains: List<String> ->
      val manager = CookieManager.getInstance()
      for (domain in domains) {
        for ((name, _) in parse(manager.getCookie("https://$domain"))) {
          manager.setCookie("https://$domain", "$name=; Max-Age=0; Path=/; Domain=$domain")
          manager.setCookie("https://$domain", "$name=; Max-Age=0; Path=/")
        }
      }
      manager.flush()
    }
  }

  private fun parse(header: String?): List<Pair<String, String>> =
    header.orEmpty().split(";").mapNotNull { part ->
      val index = part.indexOf('=')
      if (index <= 0) null else part.substring(0, index).trim() to part.substring(index + 1).trim()
    }
}
