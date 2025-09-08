/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getProjectSummaryInfo,
  type ProjectSummaryInfo,
  type Config,
} from '@qwen-code/qwen-code-core';

export interface WelcomeBackState {
  welcomeBackInfo: ProjectSummaryInfo | null;
  showWelcomeBackDialog: boolean;
  welcomeBackChoice: 'restart' | 'continue' | null;
}

export interface WelcomeBackActions {
  handleWelcomeBackSelection: (choice: 'restart' | 'continue') => void;
  handleWelcomeBackClose: () => void;
  checkWelcomeBack: () => Promise<void>;
}

export function useWelcomeBack(
  config: Config,
  submitQuery: (query: string) => void,
): WelcomeBackState & WelcomeBackActions {
  const [welcomeBackInfo, setWelcomeBackInfo] =
    useState<ProjectSummaryInfo | null>(null);
  const [showWelcomeBackDialog, setShowWelcomeBackDialog] = useState(false);
  const [welcomeBackChoice, setWelcomeBackChoice] = useState<
    'restart' | 'continue' | null
  >(null);

  // Check for conversation history on startup
  const checkWelcomeBack = useCallback(async () => {
    try {
      const info = await getProjectSummaryInfo();
      if (info.hasHistory) {
        setWelcomeBackInfo(info);
        setShowWelcomeBackDialog(true);
      }
    } catch (error) {
      // Silently ignore errors - welcome back is not critical
      console.debug('Welcome back check failed:', error);
    }
  }, []);

  // Handle welcome back dialog selection
  const handleWelcomeBackSelection = useCallback(
    (choice: 'restart' | 'continue') => {
      setWelcomeBackChoice(choice);
      setShowWelcomeBackDialog(false);

      if (choice === 'continue' && welcomeBackInfo?.content) {
        // Load conversation history as context
        const contextMessage = `Based on our previous conversation, here's the current project status:

${welcomeBackInfo.content}

Let's continue where we left off. What would you like to work on next?`;

        // Submit the context as the initial prompt
        submitQuery(contextMessage);
      }
      // If choice is 'restart', just close the dialog and continue normally
    },
    [welcomeBackInfo, submitQuery],
  );

  const handleWelcomeBackClose = useCallback(() => {
    setWelcomeBackChoice('restart'); // Default to restart when closed
    setShowWelcomeBackDialog(false);
  }, []);

  // Check for welcome back on mount
  useEffect(() => {
    checkWelcomeBack();
  }, [checkWelcomeBack]);

  return {
    // State
    welcomeBackInfo,
    showWelcomeBackDialog,
    welcomeBackChoice,
    // Actions
    handleWelcomeBackSelection,
    handleWelcomeBackClose,
    checkWelcomeBack,
  };
}
