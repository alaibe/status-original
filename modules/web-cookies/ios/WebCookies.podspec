Pod::Spec.new do |s|
  s.name           = 'WebCookies'
  s.version        = '1.0.0'
  s.summary        = 'Reads and clears the cookies of the app web views'
  s.author         = ''
  s.homepage       = 'https://github.com/alaibe/status-original'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
