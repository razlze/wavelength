import { PointsSystem as PointsSystemEnum } from "../../generated/prisma/enums";
import type { PointsSystem } from "../../generated/prisma/enums";

export const POINTS_SYSTEMS = [
  {
    id: PointsSystemEnum.PSYCHIC_DOMINANT,
    label: "Psychic Dominant",
    shortDescription: "Psychic earns all round points.",
    longDescription:
      "The Psychic earns all points from the dial result. Guessers do not gain round points.",
  },
  {
    id: PointsSystemEnum.PSYCHIC_BIASED,
    label: "Psychic Biased",
    shortDescription: "Psychic gets dial points; guessers can earn bonus points.",
    longDescription:
      "The Psychic earns all points from the dial result. If the team lands in a scoring zone, each guesser also earns +1 bonus point.",
  },
  {
    id: PointsSystemEnum.GUESSER_BIASED,
    label: "Guesser Biased",
    shortDescription: "Guessers get dial points; Psychic can earn a bonus point.",
    longDescription:
      "Each guesser earns points from the dial result. If the team lands in a scoring zone, the Psychic also earns +1 bonus point.",
  },
  {
    id: PointsSystemEnum.GUESSER_DOMINANT,
    label: "Guesser Dominant",
    shortDescription: "Guessers earn all round points.",
    longDescription:
      "Each guesser earns points from the dial result. The Psychic does not gain round points.",
  },
] as const satisfies readonly {
  id: PointsSystem;
  label: string;
  shortDescription: string;
  longDescription: string;
}[];

export type { PointsSystem };
export const RECOMMENDED_POINTS_SYSTEM: PointsSystem =
  PointsSystemEnum.PSYCHIC_BIASED;

export type RoundAwardInput = {
  pointsSystem: PointsSystem;
  baseScore: number;
  guesserIds: string[];
  psychicId: string | null;
};

export function calculateRoundAwards(input: RoundAwardInput): Map<string, number> {
  const awards = new Map<string, number>();
  const addPoints = (playerId: string, points: number) => {
    if (points <= 0) return;
    awards.set(playerId, (awards.get(playerId) ?? 0) + points);
  };
  const isScoringZone = input.baseScore > 0;

  switch (input.pointsSystem) {
    case "PSYCHIC_DOMINANT": {
      if (input.psychicId) addPoints(input.psychicId, input.baseScore);
      break;
    }
    case "PSYCHIC_BIASED": {
      if (input.psychicId) addPoints(input.psychicId, input.baseScore);
      if (isScoringZone) {
        for (const guesserId of input.guesserIds) addPoints(guesserId, 1);
      }
      break;
    }
    case "GUESSER_BIASED": {
      for (const guesserId of input.guesserIds) {
        addPoints(guesserId, input.baseScore);
      }
      if (isScoringZone && input.psychicId) addPoints(input.psychicId, 1);
      break;
    }
    case "GUESSER_DOMINANT": {
      for (const guesserId of input.guesserIds) {
        addPoints(guesserId, input.baseScore);
      }
      break;
    }
  }

  return awards;
}
