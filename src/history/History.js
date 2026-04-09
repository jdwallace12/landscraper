export class History {
  constructor(maxSteps = 50) {
    this.maxSteps = maxSteps;
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Save a snapshot before a modification begins */
  push(snapshot) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxSteps) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0; // clear redo on new action
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo(currentSnapshot) {
    if (!this.canUndo()) return null;
    this.redoStack.push(currentSnapshot);
    return this.undoStack.pop();
  }

  redo(currentSnapshot) {
    if (!this.canRedo()) return null;
    this.undoStack.push(currentSnapshot);
    return this.redoStack.pop();
  }
}
