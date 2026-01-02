#include <napi.h>
#include <string>
#include <vector>

#include "mpv/client.h"
#include "mpv/render.h"

#if defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace {

struct MpvApi {
#if defined(_WIN32)
  HMODULE handle = nullptr;
#else
  void* handle = nullptr;
#endif
  mpv_handle* (*mpv_create)();
  int (*mpv_initialize)(mpv_handle*);
  int (*mpv_command)(mpv_handle*, const char**);
  void (*mpv_terminate_destroy)(mpv_handle*);
  int (*mpv_set_option_string)(mpv_handle*, const char*, const char*);
  int (*mpv_get_property)(mpv_handle*, const char*, mpv_format, void*);
  char* (*mpv_get_property_string)(mpv_handle*, const char*);
  void (*mpv_free)(void*);
  int (*mpv_render_context_create)(mpv_render_context **, mpv_handle *, mpv_render_param *);
  void (*mpv_render_context_render)(mpv_render_context *, mpv_render_param *);
  void (*mpv_render_context_free)(mpv_render_context *);
};

MpvApi g_api;
mpv_handle* g_handle = nullptr;
mpv_render_context* g_render_ctx = nullptr;
std::vector<uint8_t> g_frame;

bool ResolveSymbol(const char* name, void** out, std::string* err) {
#if defined(_WIN32)
  FARPROC sym = GetProcAddress(g_api.handle, name);
  if (!sym) {
    if (err) *err = "missing_symbol";
    return false;
  }
  *out = reinterpret_cast<void*>(sym);
  return true;
#else
  void* sym = dlsym(g_api.handle, name);
  if (!sym) {
    if (err) *err = "missing_symbol";
    return false;
  }
  *out = sym;
  return true;
#endif
}

bool LoadLibraryWithPath(const std::string& path, std::string* err) {
  if (g_api.handle) return true;
#if defined(_WIN32)
  g_api.handle = LoadLibraryA(path.c_str());
#else
  g_api.handle = dlopen(path.c_str(), RTLD_LAZY | RTLD_LOCAL);
#endif
  if (!g_api.handle) {
    if (err) *err = "load_failed";
    return false;
  }

  if (!ResolveSymbol("mpv_create", reinterpret_cast<void**>(&g_api.mpv_create), err)) return false;
  if (!ResolveSymbol("mpv_initialize", reinterpret_cast<void**>(&g_api.mpv_initialize), err)) return false;
  if (!ResolveSymbol("mpv_command", reinterpret_cast<void**>(&g_api.mpv_command), err)) return false;
  if (!ResolveSymbol("mpv_terminate_destroy", reinterpret_cast<void**>(&g_api.mpv_terminate_destroy), err)) return false;
  if (!ResolveSymbol("mpv_set_option_string", reinterpret_cast<void**>(&g_api.mpv_set_option_string), err)) return false;
  if (!ResolveSymbol("mpv_get_property", reinterpret_cast<void**>(&g_api.mpv_get_property), err)) return false;
  if (!ResolveSymbol("mpv_get_property_string", reinterpret_cast<void**>(&g_api.mpv_get_property_string), err)) return false;
  if (!ResolveSymbol("mpv_free", reinterpret_cast<void**>(&g_api.mpv_free), err)) return false;
  if (!ResolveSymbol("mpv_render_context_create", reinterpret_cast<void**>(&g_api.mpv_render_context_create), err)) return false;
  if (!ResolveSymbol("mpv_render_context_render", reinterpret_cast<void**>(&g_api.mpv_render_context_render), err)) return false;
  if (!ResolveSymbol("mpv_render_context_free", reinterpret_cast<void**>(&g_api.mpv_render_context_free), err)) return false;

  return true;
}

bool LoadLibraryFallback(std::string* err) {
  const char* candidates[] = {
#if defined(_WIN32)
    "libmpv-2.dll",
    "mpv-2.dll",
#elif defined(__APPLE__)
    "libmpv.2.dylib",
    "libmpv.dylib",
#else
    "libmpv.so.2",
    "libmpv.so",
#endif
  };

  for (const char* candidate : candidates) {
    if (LoadLibraryWithPath(candidate, nullptr)) return true;
  }
  if (err) *err = "load_failed";
  return false;
}

Napi::Value InitMpv(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string err;

  if (g_api.handle) return Napi::Boolean::New(env, true);

  if (info.Length() > 0 && info[0].IsString()) {
    std::string path = info[0].As<Napi::String>().Utf8Value();
    if (!path.empty()) {
      if (!LoadLibraryWithPath(path, &err)) {
        Napi::Error::New(env, err).ThrowAsJavaScriptException();
        return env.Null();
      }
      return Napi::Boolean::New(env, true);
    }
  }

  if (!LoadLibraryFallback(&err)) {
    Napi::Error::New(env, err).ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::Boolean::New(env, true);
}

Napi::Value CreatePlayer(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_api.handle) {
    Napi::Error::New(env, "not_initialized").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (g_handle) {
    return Napi::Boolean::New(env, true);
  }

  g_handle = g_api.mpv_create();
  if (!g_handle) {
    Napi::Error::New(env, "mpv_create_failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  g_api.mpv_set_option_string(g_handle, "terminal", "no");
  g_api.mpv_set_option_string(g_handle, "msg-level", "all=error");
  g_api.mpv_set_option_string(g_handle, "vo", "libmpv");
  g_api.mpv_set_option_string(g_handle, "audio", "yes");
  g_api.mpv_set_option_string(g_handle, "audio-device", "auto");
  g_api.mpv_set_option_string(g_handle, "audio-exclusive", "no");
#if defined(_WIN32)
  g_api.mpv_set_option_string(g_handle, "ao", "wasapi");
#elif defined(__APPLE__)
  g_api.mpv_set_option_string(g_handle, "ao", "coreaudio");
#else
  g_api.mpv_set_option_string(g_handle, "ao", "auto");
#endif

  int res = g_api.mpv_initialize(g_handle);
  if (res < 0) {
    g_api.mpv_terminate_destroy(g_handle);
    g_handle = nullptr;
    Napi::Error::New(env, "mpv_initialize_failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (!g_render_ctx) {
    mpv_render_param params[] = {
      { MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_SW) },
      { MPV_RENDER_PARAM_INVALID, nullptr }
    };
    int r = g_api.mpv_render_context_create(&g_render_ctx, g_handle, params);
    if (r < 0) {
      g_api.mpv_terminate_destroy(g_handle);
      g_handle = nullptr;
      Napi::Error::New(env, "mpv_render_init_failed").ThrowAsJavaScriptException();
      return env.Null();
    }
  }

  return Napi::Boolean::New(env, true);
}


Napi::Value LoadFile(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_handle) {
    Napi::Error::New(env, "not_ready").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::Error::New(env, "missing_path").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string filePath = info[0].As<Napi::String>().Utf8Value();

  const char* cmd[] = { "loadfile", filePath.c_str(), nullptr };
  int res = g_api.mpv_command(g_handle, cmd);
  if (res < 0) {
    Napi::Error::New(env, "load_failed").ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Boolean::New(env, true);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_handle) return Napi::Boolean::New(env, true);
  const char* cmd[] = { "stop", nullptr };
  g_api.mpv_command(g_handle, cmd);
  return Napi::Boolean::New(env, true);
}

Napi::Value GetProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_handle) {
    Napi::Error::New(env, "not_ready").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::Error::New(env, "missing_args").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string name = info[0].As<Napi::String>().Utf8Value();
  std::string type = info[1].As<Napi::String>().Utf8Value();

  if (type == "string") {
    char* value = g_api.mpv_get_property_string(g_handle, name.c_str());
    if (!value) return env.Null();
    Napi::String out = Napi::String::New(env, value);
    g_api.mpv_free(value);
    return out;
  }

  if (type == "bool") {
    int flag = 0;
    int res = g_api.mpv_get_property(g_handle, name.c_str(), MPV_FORMAT_FLAG, &flag);
    if (res < 0) return env.Null();
    return Napi::Boolean::New(env, flag != 0);
  }

  if (type == "int") {
    int64_t val = 0;
    int res = g_api.mpv_get_property(g_handle, name.c_str(), MPV_FORMAT_INT64, &val);
    if (res < 0) return env.Null();
    return Napi::Number::New(env, static_cast<double>(val));
  }

  double val = 0.0;
  int res = g_api.mpv_get_property(g_handle, name.c_str(), MPV_FORMAT_DOUBLE, &val);
  if (res < 0) return env.Null();
  return Napi::Number::New(env, val);
}

Napi::Value Command(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_handle) {
    Napi::Error::New(env, "not_ready").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (info.Length() < 1 || !info[0].IsArray()) {
    Napi::Error::New(env, "missing_args").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto arr = info[0].As<Napi::Array>();
  std::vector<std::string> args;
  args.reserve(arr.Length());
  for (uint32_t i = 0; i < arr.Length(); ++i) {
    if (!arr.Get(i).IsString()) {
      Napi::Error::New(env, "invalid_arg").ThrowAsJavaScriptException();
      return env.Null();
    }
    args.push_back(arr.Get(i).As<Napi::String>().Utf8Value());
  }

  std::vector<const char*> cmd;
  cmd.reserve(args.size() + 1);
  for (const auto& arg : args) cmd.push_back(arg.c_str());
  cmd.push_back(nullptr);

  int res = g_api.mpv_command(g_handle, cmd.data());
  if (res < 0) {
    Napi::Error::New(env, "command_failed").ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Boolean::New(env, true);
}

Napi::Value RenderFrame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_render_ctx) {
    Napi::Error::New(env, "render_not_ready").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
    Napi::Error::New(env, "missing_size").ThrowAsJavaScriptException();
    return env.Null();
  }
  int width = info[0].As<Napi::Number>().Int32Value();
  int height = info[1].As<Napi::Number>().Int32Value();
  if (width <= 0 || height <= 0) {
    Napi::Error::New(env, "invalid_size").ThrowAsJavaScriptException();
    return env.Null();
  }

  const int stride = width * 4;
  const size_t needed = static_cast<size_t>(stride) * static_cast<size_t>(height);
  if (g_frame.size() != needed) g_frame.assign(needed, 0);

  int size[2] = { width, height };
  int stride_local = stride;
  const char* fmt = "rgba";

  mpv_render_param params[] = {
    { MPV_RENDER_PARAM_SW_SIZE, size },
    { MPV_RENDER_PARAM_SW_FORMAT, const_cast<char*>(fmt) },
    { MPV_RENDER_PARAM_SW_STRIDE, &stride_local },
    { MPV_RENDER_PARAM_SW_POINTER, g_frame.data() },
    { MPV_RENDER_PARAM_INVALID, nullptr }
  };

  g_api.mpv_render_context_render(g_render_ctx, params);
  return Napi::Buffer<uint8_t>::Copy(env, g_frame.data(), g_frame.size());
}

Napi::Value Destroy(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_render_ctx) {
    g_api.mpv_render_context_free(g_render_ctx);
    g_render_ctx = nullptr;
  }
  if (!g_handle) return Napi::Boolean::New(env, true);
  g_api.mpv_terminate_destroy(g_handle);
  g_handle = nullptr;
  return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("init", Napi::Function::New(env, InitMpv));
  exports.Set("createPlayer", Napi::Function::New(env, CreatePlayer));
  exports.Set("loadFile", Napi::Function::New(env, LoadFile));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("getProperty", Napi::Function::New(env, GetProperty));
  exports.Set("command", Napi::Function::New(env, Command));
  exports.Set("renderFrame", Napi::Function::New(env, RenderFrame));
  exports.Set("destroy", Napi::Function::New(env, Destroy));
  return exports;
}

} // namespace

NODE_API_MODULE(mpvaddon, Init)
