import { encodeMoveSequences, encodeState, MOVE_FEATURE_DIM, STATE_VECTOR_LENGTH } from '../engine/encode';
import { GameState, Move, Player } from '../engine/types';
import { MatchState } from '../engine/match';

interface ModelPolicyOptions {
  moveModelPath: string;
  doubleModelPath: string;
  player: Player;
  getMatch: () => MatchState;
}

export async function createModelPolicy(options: ModelPolicyOptions) {
  let ort;
  try {
    ort = require('onnxruntime-node');
  } catch (error) {
    throw new Error('onnxruntime-node is not installed; install optional dependency to use model bot.');
  }
  const moveSession = await ort.InferenceSession.create(options.moveModelPath);
  const doubleSession = await ort.InferenceSession.create(options.doubleModelPath);

  async function scoreMoves(state: GameState, legalMoves: Move[][]): Promise<number[]> {
    const match = options.getMatch();
    const stateVec = encodeState(state, match, options.player);
    if (stateVec.length !== STATE_VECTOR_LENGTH) {
      throw new Error(`Unexpected state length: ${stateVec.length}`);
    }
    const moveFeatures = encodeMoveSequences(legalMoves);
    const stateTensor = new ort.Tensor('float32', Float32Array.from(stateVec), [1, stateVec.length]);
    const moveTensor = new ort.Tensor(
      'float32',
      Float32Array.from(moveFeatures.flat()),
      [1, moveFeatures.length, MOVE_FEATURE_DIM]
    );
    const results = await moveSession.run({ state: stateTensor, moves: moveTensor });
    const scores = results.scores.data;
    return Array.from(scores);
  }

  async function doubleDecision(state: GameState): Promise<boolean> {
    const match = options.getMatch();
    const stateVec = encodeState(state, match, options.player);
    const stateTensor = new ort.Tensor('float32', Float32Array.from(stateVec), [1, stateVec.length]);
    const results = await doubleSession.run({ state: stateTensor });
    const logits = results.logits.data;
    return logits[0] >= 0;
  }

  return {
    async getMove(state: GameState, legalMoves: Move[][]): Promise<Move[]> {
      if (legalMoves.length === 0) return [];
      const scores = await scoreMoves(state, legalMoves);
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < scores.length; i += 1) {
        if (scores[i] > bestScore) {
          bestScore = scores[i];
          bestIndex = i;
        }
      }
      return legalMoves[bestIndex] || legalMoves[0];
    },
    async offerDouble(state: GameState): Promise<boolean> {
      return doubleDecision(state);
    },
    async acceptDouble(state: GameState): Promise<boolean> {
      return doubleDecision(state);
    }
  };
}
