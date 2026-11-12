import { Text } from "./themed-text";
import { palette, typography } from "@ecochef/design-tokens";
import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, View } from "react-native";

type Tone="success"|"error"|"info";

export function AppMessageModal({visible,title,message,tone="info",onClose,actionLabel,onAction}:{visible:boolean;title:string;message:string;tone?:Tone;onClose:()=>void;actionLabel?:string;onAction?:()=>void}){
  const color=tone==="error"?palette.cb42331:tone==="success"?palette.c12ad55:palette.c3877c8;
  const background=tone==="error"?palette.cfff0f1:tone==="success"?palette.ce7f7ed:palette.cecf4ff;
  const icon: keyof typeof Ionicons.glyphMap=tone==="error"?"alert-circle-outline":tone==="success"?"checkmark-circle-outline":"information-circle-outline";
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={styles.overlay}><View style={styles.card}><View style={[styles.icon,{backgroundColor:background}]}><Ionicons name={icon} size={28} color={color}/></View><Text style={styles.title}>{title}</Text><Text style={styles.message}>{message}</Text>{onAction?<Pressable style={({pressed})=>[styles.button,{backgroundColor:color},pressed&&styles.buttonPressed]} onPress={onAction}><Text style={styles.buttonText}>{actionLabel??"Continue"}</Text></Pressable>:null}<Pressable style={({pressed})=>[onAction?styles.secondaryButton:[styles.button,{backgroundColor:color}],pressed&&styles.buttonPressed]} onPress={onClose}><Text style={onAction?styles.secondaryButtonText:styles.buttonText}>{onAction?"Done":"Got it"}</Text></Pressable></View></View></Modal>;
}

const styles=StyleSheet.create({overlay:{flex:1,alignItems:"center",justifyContent:"center",padding:26,backgroundColor:palette.crgba_20_35_58_44},card:{width:"100%",maxWidth:350,alignItems:"center",padding:24,borderRadius:24,backgroundColor:palette.cfff,shadowColor:palette.c14233a,shadowOpacity:.16,shadowRadius:18,shadowOffset:{width:0,height:8},elevation:9},icon:{width:54,height:54,alignItems:"center",justifyContent:"center",borderRadius:27},title:{marginTop:14,color:palette.c173c39,fontSize: typography.mobile.rawSize.s19,fontWeight: typography.weight.black,textAlign:"center"},message:{marginTop:8,color:palette.c647a75,fontSize: typography.mobile.rawSize.s13,lineHeight:19,textAlign:"center"},button:{width:"100%",alignItems:"center",marginTop:20,paddingVertical:13,borderRadius:14},secondaryButton:{width:"100%",alignItems:"center",marginTop:8,paddingVertical:11,borderRadius:14,backgroundColor:palette.ceef4f1},buttonPressed:{opacity:.68},buttonText:{color:palette.cfff,fontSize: typography.mobile.rawSize.s13,fontWeight: typography.weight.black},secondaryButtonText:{color:palette.c173c39,fontSize: typography.mobile.rawSize.s13,fontWeight: typography.weight.black}});
