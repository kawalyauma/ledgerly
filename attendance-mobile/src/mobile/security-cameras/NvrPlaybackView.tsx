import{requireNativeComponent,StyleSheet,type NativeSyntheticEvent}from"react-native";

type PlaybackEvent={state:"idle"|"loading"|"ready"|"playing"|"paused"|"buffering"|"ended"|"error";message?:string};
type Props={source?:string|null;playing:boolean;positionMs:number;rate:number;onNvrPlaybackState?:(event:NativeSyntheticEvent<PlaybackEvent>)=>void;style?:any};
const NativeView=requireNativeComponent<Props>("LedgerlyNvrPlaybackView");
export function NvrPlaybackView(props:Props){return <NativeView {...props} style={[s.root,props.style]}/>}
const s=StyleSheet.create({root:{width:"100%",height:"100%",backgroundColor:"#020506"}});
