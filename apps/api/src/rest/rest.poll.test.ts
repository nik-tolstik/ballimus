import { describe, expect, it } from "vitest";

import { pollCreationInput, pollNotificationSettingsInput } from "./rest.service.js";

describe("native poll creation", () => {
  it("publishes a non-anonymous poll to General while preserving notification settings", () => {
    expect(pollCreationInput(
      { telegramGroupChatId: -100n, telegramGeneralTopicId: 1n },
      123n,
      {
        question: "Кто играет?",
        options: [
          { text: "Буду", notificationEnabled: true },
          { text: "Не буду", notificationEnabled: false },
        ],
        notificationThreshold: 10,
        allowsMultipleAnswers: false,
      },
    )).toEqual({
      telegramChatId: -100n,
      telegramTopicId: 1n,
      question: "Кто играет?",
      options: [
        { text: "Буду", notificationEnabled: true },
        { text: "Не буду", notificationEnabled: false },
      ],
      notificationThreshold: 10,
      isAnonymous: false,
      allowsMultipleAnswers: false,
      allowsRevoting: true,
      creatorTelegramUserId: 123n,
    });
  });
});

describe("native poll notification settings", () => {
  it("maps only the ordered option notification toggles to persistence", () => {
    expect(pollNotificationSettingsInput({
      options: [
        { notificationEnabled: false },
        { notificationEnabled: true },
      ],
    })).toEqual({ notificationEnabled: [false, true] });
  });
});
