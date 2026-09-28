// @headcount/audio — client audio engine (owned by the `audio` builder).
export * from './types';
export { createAudioEngine, DUCK_GAIN, SCHEDULE_LEAD_S, STARVE_MS, STOP_FADE_S } from './engine';
export { createSpeechStream, speechChunkFromResponse, base64ToArrayBuffer, TtsHttpError } from './speech-stream';
export type { SpeechStream, SpeechStreamOptions, Synthesize } from './speech-stream';
export { SentenceChunker, estimateTokens, findSentenceEnd, lastClauseBoundary, splitAtClauses } from './chunker';
export type { ChunkerOptions } from './chunker';
export { speakable, SpeakableFilter } from './speakable';
export { createPushToTalk } from './push-to-talk';
export type { PushToTalk, PushToTalkMode, PushToTalkOptions, PushToTalkResult, PushToTalkState } from './push-to-talk';
export { MIC_MESSAGES, baseMime, pickRecordingType, toMicError } from './mic';
export { pickVoice } from './browser-voice';
export { SpectrumReader, UtteranceSampler, SpeakerSampler } from './lipsync/sampler';
export { featuresFromFloatFreq, classifyFrame, analyzeBuffer, segmentSpeech, warpTimelineToSegments } from './lipsync/audio-features';
export type { AudioFeatures, FeatureFrame, VisemeSegment } from './lipsync/audio-features';
export { VISEMES, CHAR_TO_VISEME, textToVisemeSequence, alignmentToVisemeSequence, mouthFromParams } from './lipsync/visemes';
