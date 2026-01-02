{
  "targets": [
    {
      "target_name": "mpvaddon",
      "sources": [ "src/addon.cc" ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")",
        "<!(node -p \"require('node-addon-api').include\")",
        "include",
        "../../libmpv/mac"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS=1" ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "conditions": [
        [ "OS==\"win\"", {
          "defines": [ "_HAS_EXCEPTIONS=0" ]
        } ]
      ]
    }
  ]
}
