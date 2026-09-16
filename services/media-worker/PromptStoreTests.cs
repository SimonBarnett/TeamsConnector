using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class PromptStoreTests
{
    [Fact]
    public void StoresUnderGuidAndDeletesOnComplete()
    {
        var store = new PromptStore();
        var now = DateTimeOffset.UtcNow;
        var id = store.Put("utt_1", new byte[] { 1, 2, 3 }, now);
        Assert.True(Guid.TryParse(id, out _));
        Assert.NotEqual("utt_1", id);
        Assert.True(store.TryGet(id, out var wav));
        Assert.Equal(new byte[] { 1, 2, 3 }, wav);
        store.Complete("utt_1");
        Assert.False(store.TryGet(id, out _));
    }

    [Fact]
    public void SweepDropsEntriesAfterTtl()
    {
        var store = new PromptStore();
        var now = DateTimeOffset.UtcNow;
        var id = store.Put("utt_2", new byte[] { 9 }, now);
        Assert.Equal(0, store.Sweep(now.AddMinutes(1)));
        Assert.True(store.TryGet(id, out _));
        Assert.Equal(1, store.Sweep(now.AddMinutes(2)));
        Assert.False(store.TryGet(id, out _));
    }
}
