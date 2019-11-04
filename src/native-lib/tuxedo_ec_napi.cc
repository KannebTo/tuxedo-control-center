#include <napi.h>
#include "tuxedo_ec_lib/headers/tuxedo_webcam_api.h"

using namespace Napi;

Boolean webcamOn(const CallbackInfo &info) {
    int result;
    result = webcam_on();
    return Boolean::New(info.Env(), result == EC_SUCCESS);
}

Boolean webcamOff(const CallbackInfo &info) {
    int result;
    result = webcam_off();
    return Boolean::New(info.Env(), result == EC_SUCCESS);
}

Object Init(Env env, Object exports) {
    exports.Set(String::New(env, "webcamOn"), Function::New(env, webcamOn));
    exports.Set(String::New(env, "webcamOff"), Function::New(env, webcamOff));
    return exports;
}

NODE_API_MODULE(TuxedoECAPI, Init);
