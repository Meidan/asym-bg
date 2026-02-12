import { encodeMoveSequences, encodeState, MOVE_FEATURE_DIM, STATE_VECTOR_LENGTH } from '../engine/encode';
import { makeMove } from '../engine/game';
import { GameState, Move, Player } from '../engine/types';
import { MatchState } from '../engine/match';

interface ModelPolicyOptions {
  valueModelPath?: string;
  moveModelPath?: string;
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
  const valueModelPath = options.valueModelPath ?? options.moveModelPath;
  if (!valueModelPath) {
    throw new Error('valueModelPath is required');
  }
  const valueSession = await ort.InferenceSession.create(valueModelPath);
  const doubleSession = await ort.InferenceSession.create(options.doubleModelPath);
  const valueInputNames = new Set(valueSession.inputNames);
  const usesMoveFeatures = valueInputNames.has('moves');
  const valueOutputName = valueSession.outputNames[0];

  async function scoreMoves(state: GameState, legalMoves: Move[][]): Promise<number[]> {
    const match = options.getMatch();
    if (usesMoveFeatures) {
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
      const results = await valueSession.run({ state: stateTensor, moves: moveTensor });
      const scores = results[valueOutputName].data;
      return Array.from(scores);
    }

    const scored = new Array(legalMoves.length).fill(-Infinity);
    const stateVectors: number[] = [];
    const indexMap: number[] = [];
    const actorMap: Player[] = [];

    for (let i = 0; i < legalMoves.length; i += 1) {
      const seq = legalMoves[i];
      const result = makeMove(state, seq);
      if (!result.valid || !result.newState) {
        continue;
      }
      const actor = result.newState.currentPlayer;
      const stateVec = encodeState(result.newState, match, actor);
      if (stateVec.length !== STATE_VECTOR_LENGTH) {
        throw new Error(`Unexpected state length: ${stateVec.length}`);
      }
      stateVectors.push(...stateVec);
      indexMap.push(i);
      actorMap.push(actor);
    }

    if (indexMap.length === 0) {
      return scored;
    }

    const stateTensor = new ort.Tensor(
      'float32',
      Float32Array.from(stateVectors),
      [indexMap.length, STATE_VECTOR_LENGTH]
    );
    const results = await valueSession.run({ state: stateTensor });
    const values = results[valueOutputName].data;
    for (let i = 0; i < indexMap.length; i += 1) {
      const actor = actorMap[i];
      const value = values[i];
      scored[indexMap[i]] = actor === options.player ? value : -value;
    }
    return scored;
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
